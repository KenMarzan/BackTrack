"""
Rollback Executor — legacy wrapper kept for:
  1. Rollback history log (/data/rollback_log.json) read by /rollback/history
  2. The manual /rollback/trigger endpoint in main.py

The actual rollback logic now lives in src/runtime/kubernetes.py and
src/runtime/docker_adapter.py (via RuntimeAdapter.rollback).
This class is retained only for _append_log() and get_history().
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone

from src.config import config
from src.versions import VersionStore

logger = logging.getLogger("backtrack.rollback")

_DATA_DIR = os.getenv("BACKTRACK_DATA_DIR", "/data")
ROLLBACK_LOG_FILE = os.path.join(_DATA_DIR, "rollback_log.json")


class RollbackExecutor:
    """Manages rollback history log. Rollback execution delegated to RuntimeAdapter."""

    def __init__(self, version_store: VersionStore) -> None:
        self.version_store = version_store

    def _append_log(
        self,
        reason: str,
        from_tag: str,
        to_tag: str,
        success: bool,
        service_name: str = "",
        rollback_triggered_at: str = "",
        rollback_completed_at: str = "",
        first_anomaly_at: str = "",
    ) -> None:
        log_dir = os.path.dirname(ROLLBACK_LOG_FILE)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        now = datetime.now(timezone.utc).isoformat()
        log_entry = {
            "id": str(uuid.uuid4()),
            "timestamp": now,
            "first_anomaly_at": first_anomaly_at or rollback_triggered_at or now,
            "rollback_triggered_at": rollback_triggered_at or now,
            "rollback_completed_at": rollback_completed_at or now,
            "reason": reason,
            "from_tag": from_tag,
            "to_tag": to_tag,
            "service_name": service_name,
            "mode": config.mode,
            "success": success,
        }

        entries: list[dict] = []
        if os.path.exists(ROLLBACK_LOG_FILE):
            try:
                with open(ROLLBACK_LOG_FILE) as f:
                    entries = json.load(f)
            except Exception:
                entries = []

        entries.insert(0, log_entry)

        tmp_file = ROLLBACK_LOG_FILE + ".tmp"
        with open(tmp_file, "w") as f:
            json.dump(entries, f, indent=2)
        os.replace(tmp_file, ROLLBACK_LOG_FILE)

    @staticmethod
    def get_history() -> list[dict]:
        if not os.path.exists(ROLLBACK_LOG_FILE):
            return []
        try:
            with open(ROLLBACK_LOG_FILE) as f:
                return json.load(f)
        except Exception:
            return []
