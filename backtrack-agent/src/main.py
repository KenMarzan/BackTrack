"""
Backtrack Agent — FastAPI entrypoint.
Exposes /health, /config, /metrics, /lsi, /versions, /rollback endpoints.
Runs TSD + LSI collectors and polling loop as background tasks.
"""
import asyncio
import logging
import time

from fastapi import FastAPI
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

app = FastAPI(title="Backtrack Agent", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Singletons — initialised at startup
tsd_collector: TSDCollector = TSDCollector()
lsi_collector: LSICollector = LSICollector()
version_store: VersionStore | None = None
rollback_executor: RollbackExecutor | None = None

# Polling loop state
consecutive_anomaly_count = 0
clean_seconds = 0
STABLE_THRESHOLD_SECONDS = 600  # 10 minutes of clean readings → STABLE


async def polling_loop() -> None:
    """
    Main polling loop. Every scrape_interval:
    - Check TSD.is_drifting() AND LSI.is_anomalous()
    - If both true for 3 consecutive cycles → trigger rollback (stub for now)
    - If both false for 10 minutes → mark current version as STABLE
    """
    global consecutive_anomaly_count, clean_seconds, version_store, rollback_executor

    while True:
        await asyncio.sleep(config.scrape_interval)
        try:
            drifting = tsd_collector.is_drifting()
            anomalous = lsi_collector.is_anomalous()

            if drifting and anomalous:
                consecutive_anomaly_count += 1
                clean_seconds = 0
                logger.warning(
                    "Anomaly cycle %d/3: TSD drifting=%s, LSI anomalous=%s",
                    consecutive_anomaly_count, drifting, anomalous,
                )
                if consecutive_anomaly_count >= 3 and rollback_executor:
                    logger.critical("ROLLBACK TRIGGERED — 3 consecutive anomaly cycles detected.")
                    rollback_executor.trigger(
                        reason="TSD drift + LSI anomaly sustained for 3 consecutive cycles"
                    )
                    consecutive_anomaly_count = 0
            else:
                consecutive_anomaly_count = 0
                clean_seconds += config.scrape_interval

                if clean_seconds >= STABLE_THRESHOLD_SECONDS and version_store:
                    pending = version_store.get_current_pending()
                    if pending and pending.status == "PENDING":
                        version_store.mark_stable(
                            pending.id,
                            tsd_baseline=tsd_collector.get_metrics().get("current", {}),
                            lsi_baseline=lsi_collector.get_lsi().get("baseline_mean", 0.0),
                        )
                        clean_seconds = 0
                        logger.info("Version marked STABLE after %ds clean.", STABLE_THRESHOLD_SECONDS)

        except Exception:
            logger.exception("Error in polling loop")


@app.on_event("startup")
async def startup() -> None:
    global version_store, rollback_executor

    config.log_startup_summary()

    # Initialise version store and rollback executor
    version_store = VersionStore(image_tag=config.image_tag)
    rollback_executor = RollbackExecutor(version_store)

    # Start collectors
    await tsd_collector.start()
    await lsi_collector.start()

    # Start polling loop
    asyncio.create_task(polling_loop())

    logger.info("Backtrack agent started on port 9090.")


@app.on_event("shutdown")
async def shutdown() -> None:
    await tsd_collector.stop()
    await lsi_collector.stop()
    logger.info("Backtrack agent shut down.")


# ─── Endpoints ──────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "mode": config.mode,
        "uptime_seconds": round(time.time() - START_TIME, 1),
    }


@app.get("/config")
async def get_config() -> dict:
    return config.to_dict()


@app.get("/metrics")
async def get_metrics() -> dict:
    return tsd_collector.get_metrics()


@app.get("/lsi")
async def get_lsi() -> dict:
    return lsi_collector.get_lsi()


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
