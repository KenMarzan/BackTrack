"""
Runtime adapter factory.
Returns the correct adapter based on current config mode.
"""
from src.config import config
from .base import RuntimeAdapter, RollbackTarget, Service
from .kubernetes import KubernetesAdapter
from .docker_adapter import DockerAdapter

__all__ = ["get_adapter", "RuntimeAdapter", "RollbackTarget", "Service"]


def get_adapter() -> RuntimeAdapter:
    if config.mode == "kubernetes":
        kubeconfig = config.clusters[0].get("kubeconfig", "") if config.clusters else ""
        return KubernetesAdapter(namespace=config.k8s_namespace, kubeconfig=kubeconfig)
    return DockerAdapter()
