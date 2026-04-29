"""
Rollback Executor.

Docker mode: Docker SDK — pull previous image tag, stop current container, run previous.
K8s mode: subprocess call to kubectl rollout undo deployment/<name> -n <namespace>.
Appends rollback events to /data/rollback_log.json.
"""
import json
import logging
import os
import subprocess
import uuid
from datetime import datetime, timezone
from typing import Optional

from src.config import config
from src.versions import Snapshot, VersionStore

logger = logging.getLogger("backtrack.rollback")

_DATA_DIR = os.getenv("BACKTRACK_DATA_DIR", "/data")
ROLLBACK_LOG_FILE = os.path.join(_DATA_DIR, "rollback_log.json")


class RollbackExecutor:
    """Executes rollback to the last known stable version."""

    def __init__(self, version_store: VersionStore) -> None:
        self.version_store = version_store

    def trigger(self, reason: str) -> dict:
        """
        Main entry point — rolls back to last stable version.
        Returns a result dict with success status and details.
        """
        if not config.rollback_enabled:
            msg = "Rollback disabled by BACKTRACK_ROLLBACK_ENABLED=false"
            logger.info(msg)
            return {"success": False, "message": msg}

        last_stable = self.version_store.get_last_stable()
        if last_stable is None:
            msg = "No stable version found — cannot rollback."
            logger.error(msg)
            return {"success": False, "message": msg}

        current_pending = self.version_store.get_current_pending()
        from_tag = current_pending.image_tag if current_pending else "unknown"
        to_tag = last_stable.image_tag

        logger.warning(
            "EXECUTING ROLLBACK: %s → %s (reason: %s)",
            from_tag, to_tag, reason,
        )

        try:
            if config.mode == "docker":
                self._rollback_docker(last_stable)
            else:
                self._rollback_kubernetes()

            # Mark current pending as rolled back
            if current_pending:
                self.version_store.mark_rolled_back(current_pending.id)

            result = {
                "success": True,
                "message": f"Rolled back from {from_tag} to {to_tag}",
                "from_tag": from_tag,
                "to_tag": to_tag,
            }

        except Exception as exc:
            result = {
                "success": False,
                "message": f"Rollback failed: {exc}",
                "from_tag": from_tag,
                "to_tag": to_tag,
            }
            logger.exception("Rollback execution failed")

        # Log the rollback event
        self._append_log(reason, from_tag, to_tag, result["success"])

        return result

    def _rollback_docker(self, stable: Snapshot) -> None:
        """Docker mode: stop current container and run previous image."""
        import docker

        client = docker.from_env()
        container = client.containers.get(config.target)
        image = stable.image_tag
        network_mode = container.attrs.get("HostConfig", {}).get("NetworkMode", "bridge")

        logger.info("Stopping container %s ...", config.target)
        container.stop()
        container.remove()

        logger.info("Starting container %s with image %s ...", config.target, image)
        client.containers.run(
            image,
            detach=True,
            name=config.target,
            network_mode=network_mode,
        )
        logger.info("Docker rollback complete.")

    def _rollback_kubernetes(self) -> None:
        """K8s mode: kubectl rollout undo."""
        # Determine deployment name from label selector
        name = config.target or config.k8s_label_selector.split("=")[-1]
        cmd = [
            "kubectl", "rollout", "undo",
            f"deployment/{name}",
            "-n", config.k8s_namespace,
        ]
        logger.info("Running: %s", " ".join(cmd))
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        logger.info("kubectl rollout undo output: %s", result.stdout.strip())

    def _append_log(self, reason: str, from_tag: str, to_tag: str, success: bool) -> None:
        """Append a rollback event to the log file."""
        log_dir = os.path.dirname(ROLLBACK_LOG_FILE)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        log_entry = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "reason": reason,
            "from_tag": from_tag,
            "to_tag": to_tag,
            "mode": config.mode,
            "success": success,
        }

        entries: list[dict] = []
        if os.path.exists(ROLLBACK_LOG_FILE):
            try:
                with open(ROLLBACK_LOG_FILE, "r") as f:
                    entries = json.load(f)
            except Exception:
                entries = []

        entries.insert(0, log_entry)

        with open(ROLLBACK_LOG_FILE, "w") as f:
            json.dump(entries, f, indent=2)

    @staticmethod
    def get_history() -> list[dict]:
        """Read rollback log file."""
        if not os.path.exists(ROLLBACK_LOG_FILE):
            return []
        try:
            with open(ROLLBACK_LOG_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return []
