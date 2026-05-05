"""
Shared in-process pod state cache backed by the kubernetes Python SDK watch stream.
Replaces per-service kubectl subprocess calls for pod existence checks.
"""
import asyncio
import logging
from typing import Optional

logger = logging.getLogger("backtrack.k8s_pod_cache")


class PodCache:
    def __init__(self) -> None:
        self._pods: dict[str, dict] = {}
        self.available: bool = False
        self._watch_task: Optional[asyncio.Task] = None
        self._stop_event: asyncio.Event = asyncio.Event()

    def get_running_pod(self, service_name: str, namespace: str) -> Optional[str]:
        needle = service_name.lower().replace(".", "-")
        candidates: list[str] = []
        for key, pod in self._pods.items():
            if pod["namespace"] != namespace:
                continue
            if pod["status"] != "Running":
                continue
            pod_name = pod["name"].lower()
            if pod_name == needle or pod_name.startswith(needle + "-"):
                candidates.insert(0, pod["name"])
            elif needle in pod_name:
                candidates.append(pod["name"])
        return candidates[0] if candidates else None

    def get_pods_for_service(self, service_name: str, namespace: str) -> list[str]:
        """Return all running pod names matching service_name in namespace."""
        needle = service_name.lower().replace(".", "-")
        result = []
        for pod in self._pods.values():
            if pod["namespace"] != namespace:
                continue
            if pod["status"] != "Running":
                continue
            pod_name = pod["name"].lower()
            if pod_name == needle or pod_name.startswith(needle + "-") or needle in pod_name:
                result.append(pod["name"])
        return result

    async def start(self, namespace: str) -> None:
        self._stop_event.clear()
        try:
            from kubernetes import client, config as k8s_config, watch as k8s_watch  # type: ignore
            try:
                k8s_config.incluster_config()
            except Exception:
                k8s_config.load_kube_config()

            v1 = client.CoreV1Api()
            loop = asyncio.get_event_loop()

            # Populate the cache with the current pod list BEFORE setting available=True.
            # Without this, all LSI collectors would call get_running_pod() while _pods is
            # empty (the watch stream hasn't delivered its initial events yet) and loop in
            # "No running pod found — retrying in 5s" until the stream catches up.
            await loop.run_in_executor(None, self._initial_list, v1, namespace)
            self.available = True

            self._watch_task = asyncio.create_task(
                self._watch_pods(namespace, v1, k8s_watch)
            )
            logger.info("PodCache started for namespace=%s, %d pods cached", namespace, len(self._pods))
        except Exception as exc:
            logger.warning("PodCache unavailable (no kubeconfig or SDK): %s", exc)
            self.available = False

    def _initial_list(self, v1, namespace: str) -> None:
        """One-shot list_namespaced_pod to seed the cache before the watch stream connects."""
        try:
            pod_list = v1.list_namespaced_pod(namespace=namespace)
            for obj in pod_list.items:
                name = obj.metadata.name
                ns = obj.metadata.namespace
                phase = (obj.status.phase or "Unknown") if obj.status else "Unknown"
                self._pods[f"{ns}/{name}"] = {
                    "name": name,
                    "namespace": ns,
                    "status": phase,
                    "node": (obj.spec.node_name or "") if obj.spec else "",
                }
            logger.info("Initial pod list: %d pods in namespace=%s", len(self._pods), namespace)
        except Exception as exc:
            logger.warning("Initial pod list failed (will rely on watch stream): %s", exc)

    async def stop(self) -> None:
        self._stop_event.set()
        if self._watch_task and not self._watch_task.done():
            self._watch_task.cancel()
            try:
                await self._watch_task
            except asyncio.CancelledError:
                pass
        self._pods.clear()
        self.available = False
        logger.info("PodCache stopped")

    async def _watch_pods(self, namespace: str, v1, k8s_watch_mod) -> None:
        """Maintain the watch stream, recreating the Watch object after each error."""
        loop = asyncio.get_event_loop()
        try:
            while not self._stop_event.is_set():
                w = k8s_watch_mod.Watch()
                try:
                    await loop.run_in_executor(
                        None, self._sync_watch, v1, w, namespace
                    )
                except asyncio.CancelledError:
                    try:
                        w.stop()
                    except Exception:
                        pass
                    raise
                except Exception as exc:
                    logger.warning("Pod watch stream error, restarting in 5s: %s", exc)
                    try:
                        w.stop()
                    except Exception:
                        pass
                    await asyncio.sleep(5)
        except asyncio.CancelledError:
            pass

    def _sync_watch(self, v1, w, namespace: str) -> None:
        for event in w.stream(
            v1.list_namespaced_pod,
            namespace=namespace,
            timeout_seconds=60,
        ):
            obj = event["object"]
            event_type = event["type"]
            name = obj.metadata.name
            ns = obj.metadata.namespace
            key = f"{ns}/{name}"

            if event_type == "DELETED":
                self._pods.pop(key, None)
            else:
                phase = obj.status.phase or "Unknown"
                node = obj.spec.node_name or ""
                self._pods[key] = {
                    "name": name,
                    "namespace": ns,
                    "status": phase,
                    "node": node,
                }


pod_cache = PodCache()
