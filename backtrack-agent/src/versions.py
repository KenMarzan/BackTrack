"""
Version Snapshot Store.

Tracks deployment versions through lifecycle: PENDING → STABLE → ROLLED_BACK.
Persists snapshots to /data/versions.json. Keeps last 5 STABLE snapshots.
"""
import json
import logging
import os
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Literal, Optional

logger = logging.getLogger("backtrack.versions")

VERSIONS_FILE = os.getenv("BACKTRACK_DATA_DIR", "/tmp/backtrack-data") + "/versions.json"
MAX_STABLE = 5


@dataclass
class Snapshot:
    id: str
    timestamp: str
    image_tag: str
    status: Literal["PENDING", "STABLE", "ROLLED_BACK"]
    tsd_baseline: dict = field(default_factory=dict)
    lsi_baseline: float = 0.0


class VersionStore:
    """Manages version snapshots with file-backed persistence."""

    def __init__(self, image_tag: str) -> None:
        self.snapshots: list[Snapshot] = []
        self._ensure_data_dir()
        self._load()

        # Create a PENDING snapshot for the current deployment
        pending = Snapshot(
            id=str(uuid.uuid4()),
            timestamp=datetime.now(timezone.utc).isoformat(),
            image_tag=image_tag,
            status="PENDING",
        )
        self.snapshots.insert(0, pending)
        self._persist()
        logger.info("Created PENDING snapshot: tag=%s id=%s", image_tag, pending.id)

    def _ensure_data_dir(self) -> None:
        os.makedirs(os.path.dirname(VERSIONS_FILE), exist_ok=True)

    def _load(self) -> None:
        """Read snapshots from JSON file."""
        if not os.path.exists(VERSIONS_FILE):
            self.snapshots = []
            return
        try:
            with open(VERSIONS_FILE, "r") as f:
                raw = json.load(f)
            self.snapshots = [Snapshot(**item) for item in raw]
        except Exception:
            logger.warning("Failed to load versions file, starting fresh")
            self.snapshots = []

    def _persist(self) -> None:
        """Write snapshots to JSON file."""
        try:
            with open(VERSIONS_FILE, "w") as f:
                json.dump([asdict(s) for s in self.snapshots], f, indent=2)
        except Exception:
            logger.exception("Failed to persist versions")

    def mark_stable(self, snapshot_id: str, tsd_baseline: Optional[dict] = None, lsi_baseline: float = 0.0) -> None:
        """Mark a snapshot as STABLE. Prune to keep only MAX_STABLE stable snapshots."""
        for snap in self.snapshots:
            if snap.id == snapshot_id:
                snap.status = "STABLE"
                snap.tsd_baseline = tsd_baseline or {}
                snap.lsi_baseline = lsi_baseline
                logger.info("Marked STABLE: tag=%s id=%s", snap.image_tag, snap.id)
                break

        # Prune: keep only the newest MAX_STABLE stable snapshots
        stable = [s for s in self.snapshots if s.status == "STABLE"]
        if len(stable) > MAX_STABLE:
            to_remove = stable[MAX_STABLE:]
            self.snapshots = [s for s in self.snapshots if s not in to_remove]

        self._persist()

    def mark_rolled_back(self, snapshot_id: str) -> None:
        """Mark a snapshot as ROLLED_BACK."""
        for snap in self.snapshots:
            if snap.id == snapshot_id:
                snap.status = "ROLLED_BACK"
                logger.info("Marked ROLLED_BACK: tag=%s id=%s", snap.image_tag, snap.id)
                break
        self._persist()

    def get_last_stable(self) -> Optional[Snapshot]:
        """Return the most recent STABLE snapshot, or None."""
        for snap in self.snapshots:
            if snap.status == "STABLE":
                return snap
        return None

    def get_current_pending(self) -> Optional[Snapshot]:
        """Return the current PENDING snapshot, or None."""
        for snap in self.snapshots:
            if snap.status == "PENDING":
                return snap
        return None

    def get_all(self) -> list[dict]:
        """Return all snapshots ordered newest first."""
        return [asdict(s) for s in self.snapshots]
