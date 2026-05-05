"""
Deployment Registry.

Tracks active watch windows opened when CI/CD calls POST /deployment/notify.
During a watch window, anomaly confidence scoring is amplified so that
regressions introduced by the deployment are caught faster.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Optional

WATCH_WINDOW_SECONDS = int(os.getenv("BACKTRACK_WATCH_WINDOW", "300"))  # 5 minutes


@dataclass
class WatchWindow:
    service_name: str
    version_id: str                        # Snapshot.id for this deployment
    k8s_revision: int                      # revision at deploy time
    github_deployment_id: Optional[str]    # for GitHub Deployment Status API
    commit_sha: str
    image_tag: str
    started_at: float = field(default_factory=time.time)
    expires_at: float = field(init=False)

    def __post_init__(self) -> None:
        self.expires_at = self.started_at + WATCH_WINDOW_SECONDS

    def is_active(self) -> bool:
        return time.time() < self.expires_at

    def seconds_remaining(self) -> int:
        return max(0, int(self.expires_at - time.time()))

    def elapsed_seconds(self) -> int:
        return int(time.time() - self.started_at)


class DeploymentRegistry:
    """In-memory watch window registry. One window per service at a time."""

    def __init__(self) -> None:
        self._windows: dict[str, WatchWindow] = {}

    def start_watch(
        self,
        service_name: str,
        version_id: str,
        k8s_revision: int = 0,
        github_deployment_id: Optional[str] = None,
        commit_sha: str = "",
        image_tag: str = "",
    ) -> WatchWindow:
        window = WatchWindow(
            service_name=service_name,
            version_id=version_id,
            k8s_revision=k8s_revision,
            github_deployment_id=github_deployment_id,
            commit_sha=commit_sha,
            image_tag=image_tag,
        )
        self._windows[service_name] = window
        return window

    def get_window(self, service_name: str) -> Optional[WatchWindow]:
        w = self._windows.get(service_name)
        if w is None:
            return None
        if not w.is_active():
            del self._windows[service_name]
            return None
        return w

    def is_in_watch(self, service_name: str) -> bool:
        return self.get_window(service_name) is not None

    def expire(self, service_name: str) -> None:
        """Forcibly close the watch window (called after rollback)."""
        self._windows.pop(service_name, None)

    def list_active(self) -> list[dict]:
        result = []
        for name in list(self._windows):
            w = self.get_window(name)
            if w:
                result.append({
                    "service_name": w.service_name,
                    "version_id": w.version_id,
                    "image_tag": w.image_tag,
                    "commit_sha": w.commit_sha,
                    "elapsed_seconds": w.elapsed_seconds(),
                    "seconds_remaining": w.seconds_remaining(),
                    "github_deployment_id": w.github_deployment_id,
                })
        return result
