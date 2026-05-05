"""
Abstract base for platform adapters.
Both KubernetesAdapter and DockerAdapter implement this interface so all
rollback / metric / log logic above them is platform-agnostic.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator, Optional


@dataclass
class Service:
    name: str
    platform: str                  # "kubernetes" | "docker"
    namespace: str                 # k8s namespace | "local" for docker
    image: str                     # full image URI e.g. ghcr.io/org/app:sha
    status: str                    # "running" | "stopped" | "crashed" | "unknown"
    replicas_ready: int
    replicas_total: int
    restart_count: int
    last_exit_code: Optional[int]


@dataclass
class RollbackTarget:
    service_name: str
    platform: str                  # "kubernetes" | "docker"
    # Kubernetes fields
    deployment_name: str
    namespace: str
    to_revision: int               # 0 = undo to immediately previous; N = explicit revision
    # Docker fields
    container_name: str
    stable_image: str              # full image URI to restore to
    # Audit
    reason: str
    anomaly_type: str              # "TSD" | "LSI" | "TSD+LSI" | "CRASH" | "MANUAL"
    first_anomaly_at: str          # ISO timestamp


class RuntimeAdapter(ABC):
    """Platform-specific implementation contract."""

    @abstractmethod
    async def get_service(self, name: str) -> Service:
        """Return current runtime state of the named service."""

    @abstractmethod
    async def get_metrics(self, name: str) -> dict:
        """
        Return current metrics snapshot.
        Keys: cpu_pct, mem_mb, latency_ms, error_rate_pct
        """

    @abstractmethod
    async def stream_logs(self, name: str, tail: int = 100) -> AsyncIterator[str]:
        """Async-generator yielding log lines as plain strings."""

    @abstractmethod
    async def rollback(self, target: RollbackTarget) -> dict:
        """
        Execute rollback.
        Returns {"success": bool, "message": str, "from_image": str, "to_image": str}
        """

    @abstractmethod
    async def get_current_revision(self, name: str) -> int:
        """
        Return the current rollout revision number.
        Kubernetes: deployment.kubernetes.io/revision annotation value.
        Docker: always 0 (no revision concept).
        """
