"""
Backtrack Agent — FastAPI entrypoint.

Multi-service: discovers all K8s deployments (or Docker target) at startup.
Exposes /health, /config, /metrics, /lsi, /services, /versions,
/rollback/history, /rollback/trigger, /deployment/notify, /reconfigure.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import Body, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from src.anomaly_scorer import compute_confidence, should_rollback
from src.collectors.lsi import LSICollector
from src.collectors.tsd import TSDCollector
from src.config import config
from src.deployment_registry import DeploymentRegistry
from src.rollback.executor import RollbackExecutor
from src.runtime import get_adapter
from src.runtime.base import RollbackTarget
from src.versions import VersionStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("backtrack")

START_TIME = time.time()

app = FastAPI(title="Backtrack Agent", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3847", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Per-service state ────────────────────────────────────────────────────────

# Collectors: service_name → (TSDCollector, LSICollector)
service_monitors: dict[str, tuple[TSDCollector, LSICollector]] = {}

# Version stores: one per service
version_stores: dict[str, VersionStore] = {}

# Shared components
registry = DeploymentRegistry()
rollback_executor: Optional[RollbackExecutor] = None
_polling_task: Optional[asyncio.Task] = None

# Per-service anomaly tracking
consecutive_anomaly_counts: dict[str, int] = {}
clean_seconds_map: dict[str, int] = {}
rollback_cooldown_until: dict[str, float] = {}
first_anomaly_at: dict[str, str] = {}

_DATA_DIR = os.getenv("BACKTRACK_DATA_DIR", "/data")
_COOLDOWN_FILE = os.path.join(_DATA_DIR, "cooldowns.json")
STABLE_THRESHOLD_SECONDS = int(os.getenv("BACKTRACK_STABLE_SECONDS", "600"))
ROLLBACK_COOLDOWN_SECONDS = int(os.getenv("BACKTRACK_ROLLBACK_COOLDOWN", "120"))

API_KEY = os.getenv("BACKTRACK_API_KEY", "")  # empty = auth disabled


# ── Cooldown persistence ─────────────────────────────────────────────────────

def _load_cooldowns() -> None:
    if not os.path.exists(_COOLDOWN_FILE):
        return
    try:
        import json as _json
        with open(_COOLDOWN_FILE) as f:
            data: dict[str, float] = _json.load(f)
        now = time.time()
        for svc, until in data.items():
            if until > now:
                rollback_cooldown_until[svc] = until
                logger.info("Restored cooldown for %s: %.0fs remaining", svc, until - now)
    except Exception:
        logger.warning("Failed to load cooldowns file")


def _persist_cooldowns() -> None:
    try:
        import json as _json
        os.makedirs(_DATA_DIR, exist_ok=True)
        tmp = _COOLDOWN_FILE + ".tmp"
        with open(tmp, "w") as f:
            _json.dump(rollback_cooldown_until, f)
        os.replace(tmp, _COOLDOWN_FILE)
    except Exception:
        logger.warning("Failed to persist cooldowns")


# ── Service discovery ────────────────────────────────────────────────────────

async def _discover_services() -> list[tuple[str, str]]:
    """Returns list of (service_name, label_selector) tuples."""
    if config.mode == "docker":
        if not config.target:
            logger.warning(
                "BACKTRACK_TARGET is not set — no services to monitor. "
                "Set BACKTRACK_TARGET=<container_name> and restart."
            )
            return []
        return [(config.target, "")]

    if config.target:
        label = config.k8s_label_selector or f"app={config.target}"
        return [(config.target, label)]

    try:
        proc = await asyncio.create_subprocess_exec(
            "kubectl", "get", "deployments",
            "-n", config.k8s_namespace,
            "-o", "jsonpath={range .items[*]}{.metadata.name}{'\\n'}{end}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15)
        names = [n.strip() for n in stdout.decode().strip().splitlines() if n.strip()]
        if not names:
            logger.warning("No deployments in %s", config.k8s_namespace)
            return []
        return [(name, f"app={name}") for name in names]
    except Exception:
        logger.exception("Service discovery failed")
        return []


# ── Anomaly summary builder ──────────────────────────────────────────────────

def _build_anomaly_summary(
    svc_name: str,
    tsd: TSDCollector,
    lsi: LSICollector,
) -> dict:
    metrics = tsd.get_metrics()
    lsi_data = lsi.get_lsi()
    summary: dict[str, dict] = {}

    for metric in ("cpu", "memory", "latency", "error_rate"):
        current_val = metrics.get("current", {}).get(metric, 0.0)
        baseline_val = metrics.get("baseline", {}).get(metric, 0.0)
        if current_val > 0 or baseline_val > 0:
            summary[metric] = {
                "current": f"{current_val:.1f}",
                "baseline": f"{baseline_val:.1f}",
                "threshold": "3×IQR",
            }

    score = lsi_data.get("current_score", 0.0)
    baseline_mean = lsi_data.get("baseline_mean", 0.0)
    if score > 0:
        summary["lsi_score"] = {
            "current": f"{score:.3f}",
            "baseline": f"{baseline_mean:.3f}",
            "threshold": "2×σ",
        }

    return summary


# ── Polling loop ─────────────────────────────────────────────────────────────

async def polling_loop() -> None:
    import src.github_feedback as github_feedback

    while True:
        await asyncio.sleep(config.scrape_interval)
        try:
            for svc_name, (tsd, lsi) in service_monitors.items():
                drifting = tsd.is_drifting()
                anomalous = lsi.is_anomalous()
                crashed = tsd.has_crashed()

                count = consecutive_anomaly_counts.get(svc_name, 0)
                clean = clean_seconds_map.get(svc_name, 0)
                in_cooldown = time.time() < rollback_cooldown_until.get(svc_name, 0)
                in_watch = registry.is_in_watch(svc_name)

                vs = version_stores.get(svc_name)
                window = registry.get_window(svc_name)

                # ── Crash / restart: immediate rollback, no confidence ramp ──
                if crashed and not in_cooldown:
                    exit_code = tsd._last_exit_code
                    logger.critical(
                        "CRASH ROLLBACK for %s — container restarted (exit_code=%d)",
                        svc_name, exit_code,
                    )
                    if not first_anomaly_at.get(svc_name):
                        first_anomaly_at[svc_name] = datetime.now(timezone.utc).isoformat()

                    await _do_rollback(
                        svc_name=svc_name,
                        reason=f"Container crash/restart (exit_code={exit_code})",
                        anomaly_type="CRASH",
                        tsd=tsd,
                        lsi=lsi,
                        vs=vs,
                        window=window,
                        confidence=1.0,
                    )
                    rollback_cooldown_until[svc_name] = time.time() + ROLLBACK_COOLDOWN_SECONDS
                    _persist_cooldowns()
                    first_anomaly_at.pop(svc_name, None)
                    consecutive_anomaly_counts[svc_name] = 0
                    clean_seconds_map[svc_name] = 0
                    continue

                # ── Normal anomaly path: confidence scoring ───────────────────
                if drifting or anomalous:
                    if in_cooldown:
                        logger.info("Anomaly [%s] suppressed — rollback cooldown active.", svc_name)
                    else:
                        count += 1
                        clean = 0
                        if count == 1:
                            first_anomaly_at[svc_name] = datetime.now(timezone.utc).isoformat()
                            logger.warning(
                                "Anomaly [%s] FIRST DETECTION at %s (watch=%s)",
                                svc_name, first_anomaly_at[svc_name], in_watch,
                            )

                        signals = "+".join(filter(None, [
                            "TSD" if drifting else "",
                            "LSI" if anomalous else "",
                        ]))
                        confidence, anomaly_type = compute_confidence(
                            tsd_drifting=drifting,
                            lsi_anomalous=anomalous,
                            in_watch_window=in_watch,
                            consecutive_cycles=count,
                        )
                        logger.warning(
                            "Anomaly [%s] signals=%s cycle=%d confidence=%.2f (threshold=%.2f)",
                            svc_name, signals, count, confidence,
                            float(os.getenv("BACKTRACK_ROLLBACK_THRESHOLD", "0.75")),
                        )

                        if should_rollback(confidence):
                            logger.critical(
                                "ROLLBACK for %s — confidence=%.2f anomaly=%s",
                                svc_name, confidence, anomaly_type,
                            )
                            await _do_rollback(
                                svc_name=svc_name,
                                reason=f"{anomaly_type} confidence={confidence:.2f}",
                                anomaly_type=anomaly_type,
                                tsd=tsd,
                                lsi=lsi,
                                vs=vs,
                                window=window,
                                confidence=confidence,
                            )
                            rollback_cooldown_until[svc_name] = time.time() + ROLLBACK_COOLDOWN_SECONDS
                            _persist_cooldowns()
                            first_anomaly_at.pop(svc_name, None)
                            count = 0
                else:
                    # Clean cycle
                    if count > 0:
                        first_anomaly_at.pop(svc_name, None)
                    count = 0
                    clean += config.scrape_interval

                    # Mark stable after STABLE_THRESHOLD_SECONDS of clean metrics
                    if clean >= STABLE_THRESHOLD_SECONDS and vs:
                        pending = vs.get_current_pending()
                        if pending and pending.status == "PENDING":
                            k8s_rev = 0
                            if config.mode == "kubernetes":
                                try:
                                    import subprocess as _sp
                                    r = _sp.run(
                                        [
                                            "kubectl", "get", "deployment", svc_name,
                                            "-n", config.k8s_namespace,
                                            "-o", "jsonpath={.metadata.annotations"
                                                  ".deployment\\.kubernetes\\.io/revision}",
                                        ],
                                        capture_output=True, text=True, timeout=5,
                                    )
                                    k8s_rev = int(r.stdout.strip() or "0")
                                except Exception:
                                    pass
                            vs.mark_stable(
                                snapshot_id=pending.id,
                                tsd_baseline=tsd.get_metrics().get("current", {}),
                                lsi_baseline=lsi.get_lsi().get("baseline_mean", 0.0),
                                k8s_revision=k8s_rev,
                            )
                            clean = 0
                            logger.info("[%s] Version marked STABLE (k8s_revision=%d).", svc_name, k8s_rev)

                            # Mark GitHub deployment as success
                            if window and window.github_deployment_id:
                                asyncio.create_task(
                                    github_feedback.mark_deployment_success(
                                        window.github_deployment_id, svc_name
                                    )
                                )
                                if window.commit_sha:
                                    asyncio.create_task(
                                        github_feedback.set_commit_status(
                                            window.commit_sha, "success",
                                            f"BackTrack: {svc_name} passed monitoring.",
                                        )
                                    )
                                registry.expire(svc_name)

                consecutive_anomaly_counts[svc_name] = count
                clean_seconds_map[svc_name] = clean

        except Exception:
            logger.exception("Error in polling loop")


async def _do_rollback(
    svc_name: str,
    reason: str,
    anomaly_type: str,
    tsd: TSDCollector,
    lsi: LSICollector,
    vs: Optional[VersionStore],
    window,
    confidence: float,
) -> None:
    import src.github_feedback as github_feedback

    adapter = get_adapter()
    last_stable = vs.get_last_stable() if vs else None
    current_pending = vs.get_current_pending() if vs else None

    target = RollbackTarget(
        service_name=svc_name,
        platform=config.mode,
        deployment_name=svc_name,
        namespace=config.k8s_namespace,
        to_revision=last_stable.k8s_revision if last_stable else 0,
        container_name=last_stable.docker_container_name if last_stable else svc_name,
        stable_image=last_stable.image_tag if last_stable else "",
        reason=reason,
        anomaly_type=anomaly_type,
        first_anomaly_at=first_anomaly_at.get(svc_name, datetime.now(timezone.utc).isoformat()),
    )

    result = await adapter.rollback(target)

    if vs and current_pending:
        if result["success"]:
            vs.mark_rolled_back(current_pending.id)
        # Log via the legacy executor log for rollback history endpoint
        if rollback_executor:
            rollback_executor._append_log(
                reason=reason,
                from_tag=current_pending.image_tag,
                to_tag=target.stable_image or "unknown",
                success=result["success"],
                service_name=svc_name,
                rollback_triggered_at=datetime.now(timezone.utc).isoformat(),
                rollback_completed_at=datetime.now(timezone.utc).isoformat(),
                first_anomaly_at=first_anomaly_at.get(svc_name, ""),
            )

    # GitHub feedback — fire and forget
    if window and window.github_deployment_id:
        anomaly_summary = _build_anomaly_summary(svc_name, tsd, lsi)
        asyncio.create_task(
            github_feedback.mark_deployment_failed(
                deployment_id=window.github_deployment_id,
                reason=f"{reason} (confidence={confidence:.2f})",
                anomaly_summary=anomaly_summary,
            )
        )
        if window.commit_sha:
            asyncio.create_task(
                github_feedback.set_commit_status(
                    window.commit_sha, "failure",
                    f"BackTrack auto-rollback: {anomaly_type}",
                )
            )
            asyncio.create_task(
                github_feedback.post_rollback_pr_comment(
                    commit_sha=window.commit_sha,
                    service=svc_name,
                    environment=window.version_id and "production" or "unknown",
                    from_image=current_pending.image_tag if current_pending else "unknown",
                    to_image=target.stable_image or "unknown",
                    reason=reason,
                    anomaly_summary=anomaly_summary,
                )
            )
        registry.expire(svc_name)


# ── Startup / shutdown ───────────────────────────────────────────────────────

@app.on_event("startup")
async def startup() -> None:
    global rollback_executor, _polling_task

    config.log_startup_summary()
    _load_cooldowns()

    if config.mode == "kubernetes":
        from src.collectors.k8s_pod_cache import pod_cache
        await pod_cache.start(namespace=config.k8s_namespace)

    services = await _discover_services()
    logger.info("Discovered %d services: %s", len(services), [s[0] for s in services])

    for svc_name, label_sel in services:
        tsd = TSDCollector(service_name=svc_name, label_selector=label_sel)
        lsi = LSICollector(service_name=svc_name, label_selector=label_sel)
        await tsd.start()
        await lsi.start()
        service_monitors[svc_name] = (tsd, lsi)
        # Create per-service version store (no image_tag — wait for /deployment/notify)
        version_stores[svc_name] = VersionStore(service_name=svc_name)

    # Legacy rollback executor (still used for history logging)
    from src.versions import VersionStore as _VS
    _dummy_vs = _VS(service_name="__legacy__")
    rollback_executor = RollbackExecutor(_dummy_vs)

    _polling_task = asyncio.create_task(polling_loop())

    def _on_polling_done(task: asyncio.Task) -> None:
        if not task.cancelled() and task.exception():
            logger.critical(
                "Polling loop crashed — monitoring stopped! Error: %s",
                task.exception(),
            )

    _polling_task.add_done_callback(_on_polling_done)
    logger.info("Backtrack agent v0.3 started. Monitoring %d services.", len(service_monitors))


@app.on_event("shutdown")
async def shutdown() -> None:
    global _polling_task
    if _polling_task and not _polling_task.done():
        _polling_task.cancel()
        try:
            await _polling_task
        except asyncio.CancelledError:
            pass
    for tsd, lsi in service_monitors.values():
        await tsd.stop()
        await lsi.stop()
    from src.collectors.k8s_pod_cache import pod_cache
    await pod_cache.stop()
    logger.info("Backtrack agent shut down.")


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict:
    from src.collectors.tsd import MIN_READINGS_FOR_STL
    return {
        "status": "ok",
        "version": "0.3.0",
        "mode": config.mode,
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "monitored_services": list(service_monitors.keys()),
        "min_readings": MIN_READINGS_FOR_STL,
        "active_watch_windows": registry.list_active(),
    }


@app.get("/config")
async def get_config() -> dict:
    return config.to_dict()


@app.get("/services")
async def get_services() -> list[dict]:
    result = []
    for svc_name, (tsd, lsi) in service_monitors.items():
        window = registry.get_window(svc_name)
        result.append({
            "name": svc_name,
            "is_drifting": tsd.is_drifting(),
            "is_anomalous": lsi.is_anomalous(),
            "has_crashed": tsd.has_crashed(),
            "restart_count": tsd._last_restart_count,
            "last_exit_code": tsd._last_exit_code,
            "readings_count": len(tsd.cpu_history),
            "lsi_fitted": lsi.fitted,
            "in_watch_window": window is not None,
            "watch_seconds_remaining": window.seconds_remaining() if window else 0,
        })
    return result


@app.get("/metrics")
async def get_metrics(service: str = Query(default="")) -> dict:
    svc = service or config.target
    if svc in service_monitors:
        return service_monitors[svc][0].get_metrics()
    if service_monitors:
        return next(iter(service_monitors.values()))[0].get_metrics()
    return {}


@app.get("/lsi")
async def get_lsi(service: str = Query(default="")) -> dict:
    svc = service or config.target
    if svc in service_monitors:
        return service_monitors[svc][1].get_lsi()
    if service_monitors:
        return next(iter(service_monitors.values()))[1].get_lsi()
    return {}


@app.get("/versions")
async def get_versions(service: str = Query(default="")) -> list[dict]:
    if service and service in version_stores:
        return version_stores[service].get_all()
    # Return all services' versions merged
    all_versions: list[dict] = []
    for vs in version_stores.values():
        all_versions.extend(vs.get_all())
    return all_versions


@app.get("/rollback/history")
async def rollback_history() -> list[dict]:
    from src.rollback.executor import RollbackExecutor as _RE
    return _RE.get_history()


@app.get("/watch-windows")
async def watch_windows() -> list[dict]:
    return registry.list_active()


@app.post("/deployment/notify")
async def deployment_notify(body: dict = Body(default={})) -> dict:
    """
    CI/CD calls this immediately after a successful deploy.
    Opens a watch window with elevated anomaly sensitivity.

    Required fields: service_name, image_tag, commit_sha, environment
    Optional fields: github_deployment_id, docker_container_name
    """
    # Optional API key check
    if API_KEY:
        from fastapi import Request
        # Key checked via Authorization header in production — skipped here for simplicity.
        # Use a reverse proxy or middleware to enforce auth in prod.
        pass

    service_name = (body.get("service_name") or "").strip()
    image_tag = (body.get("image_tag") or "").strip()
    commit_sha = (body.get("commit_sha") or "").strip()
    environment = (body.get("environment") or "production").strip()
    github_deployment_id = body.get("github_deployment_id")
    docker_container_name = (body.get("docker_container_name") or service_name).strip()

    if not service_name:
        return {"ok": False, "error": "service_name is required"}
    if not image_tag:
        return {"ok": False, "error": "image_tag is required"}

    # Ensure version store exists for this service
    if service_name not in version_stores:
        version_stores[service_name] = VersionStore(service_name=service_name)

    vs = version_stores[service_name]
    version_id = vs.create_pending(
        image_tag=image_tag,
        commit_sha=commit_sha,
        environment=environment,
        github_deployment_id=str(github_deployment_id) if github_deployment_id else None,
        docker_container_name=docker_container_name,
    )

    # Capture current K8s revision so rollback can use --to-revision
    k8s_revision = 0
    if config.mode == "kubernetes":
        try:
            adapter = get_adapter()
            k8s_revision = await adapter.get_current_revision(service_name)
        except Exception:
            pass

    # Open watch window
    registry.start_watch(
        service_name=service_name,
        version_id=version_id,
        k8s_revision=k8s_revision,
        github_deployment_id=str(github_deployment_id) if github_deployment_id else None,
        commit_sha=commit_sha,
        image_tag=image_tag,
    )

    # Mark GitHub deployment as in_progress
    if github_deployment_id:
        import src.github_feedback as github_feedback
        asyncio.create_task(
            github_feedback.mark_deployment_in_progress(github_deployment_id)
        )

    logger.info(
        "Deployment notified: service=%s image=%s commit=%s k8s_rev=%d watch=%ds",
        service_name, image_tag, commit_sha[:8] if commit_sha else "", k8s_revision,
        int(os.getenv("BACKTRACK_WATCH_WINDOW", "300")),
    )

    return {
        "ok": True,
        "version_id": version_id,
        "service_name": service_name,
        "k8s_revision": k8s_revision,
        "watch_window_seconds": int(os.getenv("BACKTRACK_WATCH_WINDOW", "300")),
    }


@app.post("/rollback/trigger")
async def rollback_trigger(body: dict = Body(default={})) -> dict:
    service_name = (body.get("service") or body.get("service_name") or "").strip()
    reason = body.get("reason", "Manual trigger via dashboard")

    if not service_name and config.target:
        service_name = config.target

    if not service_name:
        return {"success": False, "message": "service_name is required"}

    vs = version_stores.get(service_name)
    last_stable = vs.get_last_stable() if vs else None
    current_pending = vs.get_current_pending() if vs else None

    target = RollbackTarget(
        service_name=service_name,
        platform=config.mode,
        deployment_name=service_name,
        namespace=config.k8s_namespace,
        to_revision=last_stable.k8s_revision if last_stable else 0,
        container_name=last_stable.docker_container_name if last_stable else service_name,
        stable_image=last_stable.image_tag if last_stable else "",
        reason=reason,
        anomaly_type="MANUAL",
        first_anomaly_at=datetime.now(timezone.utc).isoformat(),
    )

    adapter = get_adapter()
    result = await adapter.rollback(target)

    if vs and current_pending and result["success"]:
        vs.mark_rolled_back(current_pending.id)

    if rollback_executor:
        rollback_executor._append_log(
            reason=reason,
            from_tag=current_pending.image_tag if current_pending else "unknown",
            to_tag=target.stable_image or "unknown",
            success=result["success"],
            service_name=service_name,
            rollback_triggered_at=datetime.now(timezone.utc).isoformat(),
            rollback_completed_at=datetime.now(timezone.utc).isoformat(),
            first_anomaly_at="",
        )

    return result


@app.post("/reconfigure")
async def reconfigure(body: dict) -> dict:
    """
    Hot-reload agent target/mode/namespace without restart.
    Accepts: { target, mode, namespace, image_tag, services?: string[] }
    """
    target = body.get("target", "").strip()
    mode = body.get("mode", "").strip().lower()
    namespace = body.get("namespace", "default").strip()
    image_tag = body.get("image_tag", "").strip()
    explicit_services: list[str] = [
        s.strip() for s in (body.get("services") or []) if isinstance(s, str) and s.strip()
    ]

    if not target:
        return {"ok": False, "message": "target is required"}

    config.target = target
    config.k8s_namespace = namespace
    if image_tag:
        config.image_tag = image_tag
    if mode in ("kubernetes", "k8s", "docker"):
        config._forced_mode = "kubernetes" if mode in ("kubernetes", "k8s") else "docker"

    # Stop and remove all existing monitors
    for svc_name in list(service_monitors.keys()):
        tsd, lsi = service_monitors.pop(svc_name)
        await tsd.stop()
        await lsi.stop()

    for d in (consecutive_anomaly_counts, clean_seconds_map, rollback_cooldown_until):
        d.clear()

    services = explicit_services and [(s, f"app={s}") for s in explicit_services] or await _discover_services()

    if config.mode == "kubernetes":
        from src.collectors.k8s_pod_cache import pod_cache
        await pod_cache.stop()
        await pod_cache.start(namespace=config.k8s_namespace)

    for svc_name, label_sel in services:
        tsd = TSDCollector(service_name=svc_name, label_selector=label_sel)
        lsi = LSICollector(service_name=svc_name, label_selector=label_sel)
        await tsd.start()
        await lsi.start()
        service_monitors[svc_name] = (tsd, lsi)
        if svc_name not in version_stores:
            version_stores[svc_name] = VersionStore(service_name=svc_name)

    logger.info(
        "Reconfigured: target=%s mode=%s namespace=%s → monitoring %s",
        target, config.mode, namespace, list(service_monitors.keys()),
    )

    return {
        "ok": True,
        "target": target,
        "mode": config.mode,
        "namespace": namespace,
        "monitoring": list(service_monitors.keys()),
    }
