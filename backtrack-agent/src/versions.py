"""
Version Snapshot Store.

Tracks deployment versions through lifecycle: PENDING → STABLE → ROLLED_BACK.
Persists snapshots to /data/versions.json. Keeps last 5 STABLE snapshots per service.

Schema change from v1: Snapshot now includes service_name, commit_sha, environment,
deployed_at, stable_at, docker_container_name, and github_deployment_id.
Legacy snapshots missing these fields are normalised on read.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Literal, Optional

logger = logging.getLogger("backtrack.versions")

_DATA_DIR = os.getenv("BACKTRACK_DATA_DIR", "/tmp/backtrack-data")
VERSIONS_FILE = os.path.join(_DATA_DIR, "versions.json")
MAX_STABLE = 5


@dataclass
class Snapshot:
    # Identity
    id: str
    service_name: str              # logical service name (same across platforms)
    platform: str                  # "kubernetes" | "docker"
    environment: str               # "production" | "staging" | "dev"
    # Version info
    image_tag: str                 # full image URI e.g. ghcr.io/org/app:sha
    commit_sha: str                # git SHA from CI/CD notification
    status: Literal["PENDING", "STABLE", "ROLLED_BACK"]
    # Timestamps
    deployed_at: str               # ISO — from CI/CD notification (not agent startup)
    stable_at: Optional[str]       # ISO — when STABLE_THRESHOLD passed with no anomalies
    # Platform-specific rollback targeting
    k8s_revision: int              # kubectl rollout history revision; 0 if Docker
    docker_container_name: str     # container name for docker stop/rm/run; "" if K8s
    # Baselines captured at STABLE time
    tsd_baseline: dict = field(default_factory=dict)
    lsi_baseline: float = 0.0
    # GitHub integration
    github_deployment_id: Optional[str] = None


def _normalise_raw(raw: dict) -> dict:
    """Back-fill fields absent in v1 snapshots so old data loads without error."""
    raw.setdefault("service_name", raw.get("image_tag", "unknown").split("/")[-1].split(":")[0])
    raw.setdefault("platform", "kubernetes")
    raw.setdefault("environment", "production")
    raw.setdefault("commit_sha", "")
    raw.setdefault("deployed_at", raw.get("timestamp", datetime.now(timezone.utc).isoformat()))
    raw.setdefault("stable_at", None)
    raw.setdefault("docker_container_name", "")
    raw.setdefault("github_deployment_id", None)
    raw.setdefault("tsd_baseline", {})
    raw.setdefault("lsi_baseline", 0.0)
    raw.setdefault("k8s_revision", 0)
    # Remove legacy field that doesn't exist in the new dataclass
    raw.pop("timestamp", None)
    return raw


class VersionStore:
    """Per-service version snapshot store backed by a shared JSON file."""

    def __init__(self, service_name: str, image_tag: str = "") -> None:
        self.service_name = service_name
        self._ensure_data_dir()
        self.snapshots: list[Snapshot] = []
        self._load()

        # Create initial PENDING snapshot only when image_tag is supplied (legacy path).
        # The preferred path is create_pending() called from POST /deployment/notify.
        if image_tag and image_tag != "unknown":
            self._create_pending_internal(
                image_tag=image_tag,
                commit_sha="",
                environment="production",
                github_deployment_id=None,
            )

    # ── Persistence ─────────────────────────────────────────────────────────

    def _ensure_data_dir(self) -> None:
        os.makedirs(os.path.dirname(VERSIONS_FILE), exist_ok=True)

    def _load(self) -> None:
        if not os.path.exists(VERSIONS_FILE):
            return
        try:
            with open(VERSIONS_FILE) as f:
                raw_list: list[dict] = json.load(f)
            all_snaps = [Snapshot(**_normalise_raw(r)) for r in raw_list]
            # Each VersionStore instance only owns its service's snapshots
            self.snapshots = [s for s in all_snaps if s.service_name == self.service_name]
        except Exception:
            logger.warning("Failed to load versions file for %s, starting fresh", self.service_name)
            self.snapshots = []

    def _persist(self) -> None:
        """Merge this service's snapshots back into the shared file (atomic write)."""
        # Read snapshots for OTHER services so we don't clobber them
        all_snaps: list[dict] = []
        if os.path.exists(VERSIONS_FILE):
            try:
                with open(VERSIONS_FILE) as f:
                    raw_list = json.load(f)
                all_snaps = [r for r in raw_list if r.get("service_name") != self.service_name]
            except Exception:
                all_snaps = []

        merged = all_snaps + [asdict(s) for s in self.snapshots]
        tmp = VERSIONS_FILE + ".tmp"
        try:
            with open(tmp, "w") as f:
                json.dump(merged, f, indent=2)
            os.replace(tmp, VERSIONS_FILE)
        except Exception:
            logger.exception("Failed to persist versions for %s", self.service_name)

    # ── Public API ───────────────────────────────────────────────────────────

    def create_pending(
        self,
        image_tag: str,
        commit_sha: str = "",
        environment: str = "production",
        github_deployment_id: Optional[str] = None,
        docker_container_name: str = "",
        platform: str = "",
    ) -> str:
        """
        Create a new PENDING snapshot. Returns the snapshot ID.
        Called by POST /deployment/notify — preferred over the constructor path.
        """
        return self._create_pending_internal(
            image_tag=image_tag,
            commit_sha=commit_sha,
            environment=environment,
            github_deployment_id=github_deployment_id,
            docker_container_name=docker_container_name,
            platform=platform,
        )

    def _create_pending_internal(
        self,
        image_tag: str,
        commit_sha: str,
        environment: str,
        github_deployment_id: Optional[str],
        docker_container_name: str = "",
        platform: str = "",
    ) -> str:
        from src.config import config as _config
        snap = Snapshot(
            id=str(uuid.uuid4()),
            service_name=self.service_name,
            platform=platform or _config.mode,
            environment=environment,
            image_tag=image_tag,
            commit_sha=commit_sha,
            status="PENDING",
            deployed_at=datetime.now(timezone.utc).isoformat(),
            stable_at=None,
            k8s_revision=0,
            docker_container_name=docker_container_name or self.service_name,
            github_deployment_id=github_deployment_id,
        )
        self.snapshots.insert(0, snap)
        self._persist()
        logger.info(
            "Created PENDING snapshot: service=%s tag=%s id=%s",
            self.service_name, image_tag, snap.id,
        )
        return snap.id

    def mark_stable(
        self,
        snapshot_id: str,
        tsd_baseline: Optional[dict] = None,
        lsi_baseline: float = 0.0,
        k8s_revision: int = 0,
    ) -> None:
        for snap in self.snapshots:
            if snap.id == snapshot_id:
                snap.status = "STABLE"
                snap.stable_at = datetime.now(timezone.utc).isoformat()
                snap.tsd_baseline = tsd_baseline or {}
                snap.lsi_baseline = lsi_baseline
                snap.k8s_revision = k8s_revision
                logger.info(
                    "Marked STABLE: service=%s tag=%s revision=%d",
                    self.service_name, snap.image_tag, k8s_revision,
                )
                break

        # Prune to MAX_STABLE stable snapshots
        stable = [s for s in self.snapshots if s.status == "STABLE"]
        if len(stable) > MAX_STABLE:
            remove_ids = {s.id for s in stable[MAX_STABLE:]}
            self.snapshots = [s for s in self.snapshots if s.id not in remove_ids]

        self._persist()

    def mark_rolled_back(self, snapshot_id: str) -> None:
        for snap in self.snapshots:
            if snap.id == snapshot_id:
                snap.status = "ROLLED_BACK"
                logger.info(
                    "Marked ROLLED_BACK: service=%s tag=%s",
                    self.service_name, snap.image_tag,
                )
                break
        self._persist()

    def get_last_stable(self) -> Optional[Snapshot]:
        stable = [s for s in self.snapshots if s.status == "STABLE"]
        if not stable:
            return None
        return max(stable, key=lambda s: s.deployed_at)

    def get_current_pending(self) -> Optional[Snapshot]:
        for snap in self.snapshots:
            if snap.status == "PENDING":
                return snap
        return None

    def get_all(self) -> list[dict]:
        return [asdict(s) for s in self.snapshots]
