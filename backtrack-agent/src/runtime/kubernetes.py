"""
Kubernetes runtime adapter.
Uses kubectl subprocess calls — works inside a K8s pod (ServiceAccount)
or outside with a kubeconfig on disk.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator, Optional

from .base import RuntimeAdapter, RollbackTarget, Service

logger = logging.getLogger("backtrack.runtime.kubernetes")


class KubernetesAdapter(RuntimeAdapter):

    def __init__(self, namespace: str = "default", kubeconfig: str = "") -> None:
        self.namespace = namespace
        self._base_cmd = ["kubectl"]
        if kubeconfig:
            self._base_cmd.append(f"--kubeconfig={kubeconfig}")

    async def _run(
        self, args: list[str], timeout: float = 30
    ) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec(
            *self._base_cmd, *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return 1, "", f"kubectl timed out after {timeout}s"
        return proc.returncode or 0, stdout.decode(), stderr.decode()

    async def get_service(self, name: str) -> Service:
        code, out, _ = await self._run(
            ["get", "deployment", name, "-n", self.namespace, "-o", "json"]
        )
        if code != 0:
            return Service(
                name=name, platform="kubernetes", namespace=self.namespace,
                image="unknown", status="unknown",
                replicas_ready=0, replicas_total=0,
                restart_count=0, last_exit_code=None,
            )
        try:
            d = json.loads(out)
            spec = d.get("spec", {})
            status = d.get("status", {})
            containers = spec.get("template", {}).get("spec", {}).get("containers", [])
            image = containers[0].get("image", "unknown") if containers else "unknown"
            ready = status.get("readyReplicas") or 0
            total = status.get("replicas") or 0
            if total == 0:
                svc_status = "stopped"
            elif ready == total:
                svc_status = "running"
            else:
                svc_status = "crashed"
            return Service(
                name=name, platform="kubernetes", namespace=self.namespace,
                image=image, status=svc_status,
                replicas_ready=ready, replicas_total=total,
                restart_count=0, last_exit_code=None,
            )
        except Exception:
            logger.exception("Failed to parse deployment JSON for %s", name)
            return Service(
                name=name, platform="kubernetes", namespace=self.namespace,
                image="unknown", status="unknown",
                replicas_ready=0, replicas_total=0,
                restart_count=0, last_exit_code=None,
            )

    async def get_metrics(self, name: str) -> dict:
        # Delegate to Prometheus or kubectl top if available; return zeros as fallback.
        # TSDCollector handles actual scraping — this is used for on-demand snapshots.
        code, out, _ = await self._run(
            ["top", "pod", "-n", self.namespace, "-l", f"app={name}", "--no-headers"]
        )
        if code != 0 or not out.strip():
            return {"cpu_pct": 0.0, "mem_mb": 0.0, "latency_ms": 0.0, "error_rate_pct": 0.0}
        # kubectl top output: "pod-name  250m  128Mi"
        lines = [l for l in out.strip().splitlines() if l.strip()]
        total_cpu = 0.0
        total_mem = 0.0
        for line in lines:
            parts = line.split()
            if len(parts) < 3:
                continue
            cpu_raw = parts[1]
            mem_raw = parts[2]
            if cpu_raw.endswith("m"):
                total_cpu += float(cpu_raw[:-1]) / 10.0  # millicores → rough %
            mem_raw = mem_raw.rstrip("Mi").rstrip("Gi")
            try:
                total_mem += float(mem_raw)
            except ValueError:
                pass
        return {
            "cpu_pct": total_cpu,
            "mem_mb": total_mem,
            "latency_ms": 0.0,
            "error_rate_pct": 0.0,
        }

    async def stream_logs(self, name: str, tail: int = 100) -> AsyncIterator[str]:
        proc = await asyncio.create_subprocess_exec(
            *self._base_cmd,
            "logs", "-l", f"app={name}", "-n", self.namespace,
            "--follow", f"--tail={tail}", "--max-log-requests=10",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            yield raw.decode("utf-8", errors="replace").rstrip()

    async def rollback(self, target: RollbackTarget) -> dict:
        deployment = target.deployment_name or target.service_name

        # Ensure deployment has replicas (scale-to-0 blocks rollout undo)
        code, out, _ = await self._run([
            "get", "deployment", deployment, "-n", self.namespace,
            "-o", "jsonpath={.spec.replicas}",
        ])
        current_replicas = int(out.strip() or "1") if code == 0 else 1
        if current_replicas == 0:
            logger.warning("Deployment %s scaled to 0 — restoring to 1 before rollback", deployment)
            await self._run([
                "scale", "deployment", deployment,
                "--replicas=1", "-n", self.namespace,
            ])

        cmd = ["rollout", "undo", f"deployment/{deployment}", "-n", self.namespace]
        if target.to_revision > 0:
            cmd.append(f"--to-revision={target.to_revision}")
            logger.info("Rolling back %s to revision %d", deployment, target.to_revision)

        code, out, err = await self._run(cmd)
        if code != 0:
            return {"success": False, "message": err.strip(), "from_image": "", "to_image": target.stable_image}

        # Wait for rollout to fully complete before returning
        status_code, status_out, status_err = await self._run(
            ["rollout", "status", f"deployment/{deployment}", "-n", self.namespace, "--timeout=120s"],
            timeout=130,
        )
        success = status_code == 0
        return {
            "success": success,
            "message": status_out.strip() if success else status_err.strip(),
            "from_image": "",
            "to_image": target.stable_image,
        }

    async def get_current_revision(self, name: str) -> int:
        code, out, _ = await self._run([
            "get", "deployment", name, "-n", self.namespace,
            "-o", "jsonpath={.metadata.annotations.deployment\\.kubernetes\\.io/revision}",
        ])
        if code != 0:
            return 0
        try:
            return int(out.strip())
        except ValueError:
            return 0
