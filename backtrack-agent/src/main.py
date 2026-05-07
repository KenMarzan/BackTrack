"""
Backtrack Agent — FastAPI entrypoint.
Multi-service: discovers all K8s deployments (or Docker target) at startup.
Exposes /health, /config, /metrics?service=X, /lsi?service=X, /services endpoints.
"""
import asyncio
import logging
import os
import time
from typing import Optional

from fastapi import Body, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from src.collectors.lsi import LSICollector
from src.collectors.tsd import TSDCollector
from src.config import config
from src.rollback.executor import RollbackExecutor
from src.versions import VersionStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("backtrack")

START_TIME = time.time()

app = FastAPI(title="Backtrack Agent", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3847", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Per-service collectors: {service_name: (TSDCollector, LSICollector)}
service_monitors: dict[str, tuple[TSDCollector, LSICollector]] = {}

version_store: Optional[VersionStore] = None
rollback_executor: Optional[RollbackExecutor] = None
_polling_task: Optional[asyncio.Task] = None

STABLE_THRESHOLD_SECONDS = int(os.getenv("BACKTRACK_STABLE_SECONDS", "600"))
consecutive_anomaly_counts: dict[str, int] = {}
clean_seconds_map: dict[str, int] = {}
rollback_cooldown_until: dict[str, float] = {}
first_anomaly_at: dict[str, str] = {}  # ISO timestamp of first detection per service

_DATA_DIR = os.getenv("BACKTRACK_DATA_DIR", "/data")
_COOLDOWN_FILE = os.path.join(_DATA_DIR, "cooldowns.json")


def _load_cooldowns() -> None:
    """Restore rollback cooldowns from disk after agent restart.

    Without this, a crashed agent would immediately re-trigger rollback on restart
    even though a rollback was executed moments before.
    """
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
    """Write current cooldowns atomically."""
    try:
        import json as _json
        os.makedirs(_DATA_DIR, exist_ok=True)
        tmp = _COOLDOWN_FILE + ".tmp"
        with open(tmp, "w") as f:
            _json.dump(rollback_cooldown_until, f)
        os.replace(tmp, _COOLDOWN_FILE)
    except Exception:
        logger.warning("Failed to persist cooldowns")


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

    # If a specific target is set, monitor only that deployment
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


ROLLBACK_COOLDOWN_SECONDS = int(os.getenv("BACKTRACK_ROLLBACK_COOLDOWN", "120"))


async def polling_loop() -> None:
    global consecutive_anomaly_counts, clean_seconds_map, rollback_cooldown_until, first_anomaly_at, version_store, rollback_executor

    while True:
        await asyncio.sleep(config.scrape_interval)
        try:
            for svc_name, (tsd, lsi) in service_monitors.items():
                drifting = tsd.is_drifting()
                anomalous = lsi.is_error_anomalous()  # WARN/NOVEL are informational only
                crashed = tsd.has_crashed()

                count = consecutive_anomaly_counts.get(svc_name, 0)
                clean = clean_seconds_map.get(svc_name, 0)

                in_cooldown = time.time() < rollback_cooldown_until.get(svc_name, 0)

                # Crash/restart detected → immediate rollback, no 3-cycle wait
                if crashed and not in_cooldown and rollback_executor:
                    exit_code = tsd._last_exit_code
                    logger.critical(
                        "CRASH ROLLBACK for %s — container restarted (exit_code=%d)",
                        svc_name, exit_code,
                    )
                    if not first_anomaly_at.get(svc_name):
                        from datetime import datetime, timezone
                        first_anomaly_at[svc_name] = datetime.now(timezone.utc).isoformat()
                    result = rollback_executor.trigger(
                        reason=f"Container crash/restart detected for {svc_name} (exit_code={exit_code})",
                        service_name=svc_name,
                        first_anomaly_at=first_anomaly_at.get(svc_name),
                    )
                    if result.get("success"):
                        tsd.reset()
                        lsi.reset()
                    rollback_cooldown_until[svc_name] = time.time() + ROLLBACK_COOLDOWN_SECONDS
                    _persist_cooldowns()
                    first_anomaly_at.pop(svc_name, None)
                    consecutive_anomaly_counts[svc_name] = 0
                    clean_seconds_map[svc_name] = 0
                    continue

                if drifting or anomalous:
                    if in_cooldown:
                        logger.info("Anomaly [%s] suppressed — rollback cooldown active.", svc_name)
                    else:
                        count += 1
                        clean = 0
                        signals = "+".join(filter(None, ["TSD" if drifting else "", "LSI" if anomalous else ""]))
                        # Record timestamp of first detection in this anomaly run
                        if count == 1:
                            from datetime import datetime, timezone
                            first_anomaly_at[svc_name] = datetime.now(timezone.utc).isoformat()
                            logger.warning("Anomaly [%s] FIRST DETECTION at %s", svc_name, first_anomaly_at[svc_name])
                        logger.warning("Anomaly [%s] signals=%s cycle %d/3", svc_name, signals, count)
                        if count >= 3 and rollback_executor:
                            logger.critical("ROLLBACK for %s — 3 consecutive anomaly cycles (%s).", svc_name, signals)
                            result = rollback_executor.trigger(
                                reason=f"{signals} anomaly on {svc_name} for 3 cycles",
                                service_name=svc_name,
                                first_anomaly_at=first_anomaly_at.get(svc_name),
                            )
                            if result.get("success"):
                                tsd.reset()
                                lsi.reset()
                            rollback_cooldown_until[svc_name] = time.time() + ROLLBACK_COOLDOWN_SECONDS
                            _persist_cooldowns()
                            first_anomaly_at.pop(svc_name, None)
                            count = 0
                else:
                    if count > 0:
                        first_anomaly_at.pop(svc_name, None)
                    count = 0
                    clean += config.scrape_interval
                    if clean >= STABLE_THRESHOLD_SECONDS and version_store:
                        pending = version_store.get_current_pending()
                        if pending and pending.status == "PENDING":
                            k8s_rev = 0
                            if config.mode == "kubernetes" and svc_name:
                                try:
                                    import subprocess as _sp
                                    r = _sp.run(
                                        ["kubectl", "get", "deployment", svc_name,
                                         "-n", config.k8s_namespace,
                                         "-o", "jsonpath={.metadata.annotations.deployment\\.kubernetes\\.io/revision}"],
                                        capture_output=True, text=True, timeout=5,
                                    )
                                    k8s_rev = int(r.stdout.strip() or "0")
                                except Exception:
                                    pass
                            version_store.mark_stable(
                                pending.id,
                                tsd_baseline=tsd.get_metrics().get("current", {}),
                                lsi_baseline=lsi.get_lsi().get("baseline_mean", 0.0),
                                k8s_revision=k8s_rev,
                            )
                            clean = 0
                            logger.info("[%s] Version marked STABLE (k8s_revision=%d).", svc_name, k8s_rev)

                consecutive_anomaly_counts[svc_name] = count
                clean_seconds_map[svc_name] = clean

        except Exception:
            logger.exception("Error in polling loop")


@app.on_event("startup")
async def startup() -> None:
    global version_store, rollback_executor, _polling_task

    config.log_startup_summary()
    _load_cooldowns()

    version_store = VersionStore(image_tag=config.image_tag)
    rollback_executor = RollbackExecutor(version_store)

    services = await _discover_services()
    logger.info("Discovered %d services: %s", len(services), [s[0] for s in services])

    if config.mode == "kubernetes":
        from src.collectors.k8s_pod_cache import pod_cache
        await pod_cache.start(namespace=config.k8s_namespace)

    for svc_name, label_sel in services:
        tsd = TSDCollector(service_name=svc_name, label_selector=label_sel)
        lsi = LSICollector(service_name=svc_name, label_selector=label_sel)
        await tsd.start()
        await lsi.start()
        service_monitors[svc_name] = (tsd, lsi)

    _polling_task = asyncio.create_task(polling_loop())

    def _on_polling_done(task: asyncio.Task) -> None:
        if not task.cancelled() and task.exception():
            logger.critical(
                "Polling loop crashed — monitoring has stopped! Error: %s",
                task.exception(),
            )

    _polling_task.add_done_callback(_on_polling_done)
    logger.info("Backtrack agent started. Monitoring %d services.", len(service_monitors))


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


# ─── Endpoints ──────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict:
    from src.collectors.tsd import MIN_READINGS_FOR_STL
    return {
        "status": "ok",
        "mode": config.mode,
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "monitored_services": list(service_monitors.keys()),
        "min_readings": MIN_READINGS_FOR_STL,
    }


@app.get("/config")
async def get_config() -> dict:
    return config.to_dict()


@app.get("/services")
async def get_services() -> list[dict]:
    result = []
    for svc_name, (tsd, lsi) in service_monitors.items():
        result.append({
            "name": svc_name,
            "is_drifting": tsd.is_drifting(),
            "is_anomalous": lsi.is_anomalous(),          # full signal: ERROR+WARN+NOVEL (display only)
            "is_error_anomalous": lsi.is_error_anomalous(),  # rollback signal: ERROR only
            "has_crashed": tsd.has_crashed(),
            "restart_count": tsd._last_restart_count,
            "last_exit_code": tsd._last_exit_code,
            "readings_count": len(tsd.cpu_history),
            "lsi_fitted": lsi.fitted,
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
async def get_versions() -> list[dict]:
    if version_store is None:
        return []
    return version_store.get_all()


@app.get("/rollback/history")
async def rollback_history() -> list[dict]:
    return RollbackExecutor.get_history()


@app.post("/rollback/trigger")
async def rollback_trigger(body: dict = Body(default={})) -> dict:
    if rollback_executor is None:
        return {"success": False, "message": "Rollback executor not initialised."}
    service_name = body.get("service", "") or body.get("service_name", "")
    return rollback_executor.trigger(reason="Manual trigger via dashboard", service_name=service_name)


@app.post("/reconfigure")
async def reconfigure(body: dict) -> dict:
    """
    Hot-reload agent target/mode/namespace without restart.
    Accepts: { target, mode, namespace, image_tag, services?: string[] }
    If services list provided, creates per-service collectors for each.
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

    # Update config singleton fields in-place
    config.target = target
    config.k8s_namespace = namespace
    if image_tag:
        config.image_tag = image_tag
    if mode in ("kubernetes", "k8s", "docker"):
        config._forced_mode = "kubernetes" if mode in ("kubernetes", "k8s") else "docker"

    # Stop and remove all existing monitors
    old_services = list(service_monitors.keys())
    for svc_name in old_services:
        tsd, lsi = service_monitors.pop(svc_name)
        await tsd.stop()
        await lsi.stop()

    # Reset anomaly tracking state
    for d in (consecutive_anomaly_counts, clean_seconds_map, rollback_cooldown_until):
        d.clear()

    # Build service list — prefer explicit list from dashboard (one entry per service)
    if explicit_services:
        services = [(svc, f"app={svc}") for svc in explicit_services]
        logger.info("Using %d explicit services from dashboard: %s", len(services), explicit_services)
    else:
        services = await _discover_services()

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
