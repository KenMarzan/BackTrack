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

from fastapi import FastAPI, Query
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
    allow_origins=["http://localhost:3000", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Per-service collectors: {service_name: (TSDCollector, LSICollector)}
service_monitors: dict[str, tuple[TSDCollector, LSICollector]] = {}

version_store: Optional[VersionStore] = None
rollback_executor: Optional[RollbackExecutor] = None

STABLE_THRESHOLD_SECONDS = int(os.getenv("BACKTRACK_STABLE_SECONDS", "600"))
consecutive_anomaly_counts: dict[str, int] = {}
clean_seconds_map: dict[str, int] = {}
rollback_cooldown_until: dict[str, float] = {}


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
    global consecutive_anomaly_counts, clean_seconds_map, rollback_cooldown_until, version_store, rollback_executor

    while True:
        await asyncio.sleep(config.scrape_interval)
        try:
            for svc_name, (tsd, lsi) in service_monitors.items():
                drifting = tsd.is_drifting()
                anomalous = lsi.is_anomalous()

                count = consecutive_anomaly_counts.get(svc_name, 0)
                clean = clean_seconds_map.get(svc_name, 0)

                in_cooldown = time.time() < rollback_cooldown_until.get(svc_name, 0)
                if drifting or anomalous:
                    if in_cooldown:
                        logger.info("Anomaly [%s] suppressed — rollback cooldown active.", svc_name)
                    else:
                        count += 1
                        clean = 0
                        signals = "+".join(filter(None, ["TSD" if drifting else "", "LSI" if anomalous else ""]))
                        logger.warning("Anomaly [%s] signals=%s cycle %d/3", svc_name, signals, count)
                        if count >= 3 and rollback_executor:
                            logger.critical("ROLLBACK for %s — 3 consecutive anomaly cycles (%s).", svc_name, signals)
                            rollback_executor.trigger(reason=f"{signals} anomaly on {svc_name} for 3 cycles")
                            rollback_cooldown_until[svc_name] = time.time() + ROLLBACK_COOLDOWN_SECONDS
                            count = 0
                else:
                    count = 0
                    clean += config.scrape_interval
                    if clean >= STABLE_THRESHOLD_SECONDS and version_store:
                        pending = version_store.get_current_pending()
                        if pending and pending.status == "PENDING":
                            version_store.mark_stable(
                                pending.id,
                                tsd_baseline=tsd.get_metrics().get("current", {}),
                                lsi_baseline=lsi.get_lsi().get("baseline_mean", 0.0),
                            )
                            clean = 0
                            logger.info("[%s] Version marked STABLE.", svc_name)

                consecutive_anomaly_counts[svc_name] = count
                clean_seconds_map[svc_name] = clean

        except Exception:
            logger.exception("Error in polling loop")


@app.on_event("startup")
async def startup() -> None:
    global version_store, rollback_executor

    config.log_startup_summary()

    version_store = VersionStore(image_tag=config.image_tag)
    rollback_executor = RollbackExecutor(version_store)

    services = await _discover_services()
    logger.info("Discovered %d services: %s", len(services), [s[0] for s in services])

    for svc_name, label_sel in services:
        tsd = TSDCollector(service_name=svc_name, label_selector=label_sel)
        lsi = LSICollector(service_name=svc_name, label_selector=label_sel)
        await tsd.start()
        await lsi.start()
        service_monitors[svc_name] = (tsd, lsi)

    asyncio.create_task(polling_loop())
    logger.info("Backtrack agent started. Monitoring %d services.", len(service_monitors))


@app.on_event("shutdown")
async def shutdown() -> None:
    for tsd, lsi in service_monitors.values():
        await tsd.stop()
        await lsi.stop()
    logger.info("Backtrack agent shut down.")


# ─── Endpoints ──────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "mode": config.mode,
        "uptime_seconds": round(time.time() - START_TIME, 1),
        "monitored_services": list(service_monitors.keys()),
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
            "is_anomalous": lsi.is_anomalous(),
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
async def rollback_trigger() -> dict:
    if rollback_executor is None:
        return {"success": False, "message": "Rollback executor not initialised."}
    return rollback_executor.trigger(reason="Manual trigger via dashboard")
