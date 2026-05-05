"""
Docker runtime adapter.
Uses docker CLI subprocess calls so it works with any socket location
(including rootless Docker and Docker Desktop).
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator, Optional

from .base import RuntimeAdapter, RollbackTarget, Service

logger = logging.getLogger("backtrack.runtime.docker")


def _parse_mem_mb(raw: str) -> float:
    raw = raw.strip()
    for suffix, factor in (
        ("GiB", 1024.0), ("MiB", 1.0),
        ("GB", 1024.0), ("MB", 1.0),
        ("kB", 1 / 1024.0), ("KB", 1 / 1024.0),
        ("B", 1 / 1048576.0),
    ):
        if raw.endswith(suffix):
            try:
                return float(raw[: -len(suffix)]) * factor
            except ValueError:
                return 0.0
    try:
        return float(raw) / 1048576.0
    except ValueError:
        return 0.0


class DockerAdapter(RuntimeAdapter):

    async def _run(
        self, args: list[str], timeout: float = 60
    ) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec(
            "docker", *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return 1, "", f"docker timed out after {timeout}s"
        return proc.returncode or 0, stdout.decode(), stderr.decode()

    async def get_service(self, name: str) -> Service:
        code, out, _ = await self._run(["inspect", name])
        if code != 0:
            return Service(
                name=name, platform="docker", namespace="local",
                image="unknown", status="unknown",
                replicas_ready=0, replicas_total=1,
                restart_count=0, last_exit_code=None,
            )
        try:
            data = json.loads(out)[0]
            state = data.get("State", {})
            running = state.get("Running", False)
            exit_code = state.get("ExitCode", 0)
            image = data.get("Config", {}).get("Image", "unknown")
            restart_count = data.get("RestartCount", 0)
            if running:
                status = "running"
            elif exit_code != 0:
                status = "crashed"
            else:
                status = "stopped"
            return Service(
                name=name, platform="docker", namespace="local",
                image=image, status=status,
                replicas_ready=1 if running else 0, replicas_total=1,
                restart_count=restart_count,
                last_exit_code=exit_code if not running else None,
            )
        except Exception:
            logger.exception("Failed to parse docker inspect for %s", name)
            return Service(
                name=name, platform="docker", namespace="local",
                image="unknown", status="unknown",
                replicas_ready=0, replicas_total=1,
                restart_count=0, last_exit_code=None,
            )

    async def get_metrics(self, name: str) -> dict:
        code, out, _ = await self._run([
            "stats", "--no-stream", "--format",
            "{{.CPUPerc}}\t{{.MemUsage}}", name,
        ])
        if code != 0 or not out.strip():
            return {"cpu_pct": 0.0, "mem_mb": 0.0, "latency_ms": 0.0, "error_rate_pct": 0.0}
        parts = out.strip().split("\t")
        try:
            cpu = float(parts[0].replace("%", "").strip())
        except (ValueError, IndexError):
            cpu = 0.0
        mem_mb = 0.0
        if len(parts) > 1:
            mem_mb = _parse_mem_mb(parts[1].split("/")[0].strip())
        return {"cpu_pct": cpu, "mem_mb": mem_mb, "latency_ms": 0.0, "error_rate_pct": 0.0}

    async def stream_logs(self, name: str, tail: int = 100) -> AsyncIterator[str]:
        proc = await asyncio.create_subprocess_exec(
            "docker", "logs", "--follow", "--tail", str(tail), name,
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
        container = target.container_name or target.service_name
        image = target.stable_image

        if not image:
            return {"success": False, "message": "No stable image recorded — cannot rollback.", "from_image": "", "to_image": ""}

        # Pre-pull BEFORE stopping — minimises downtime window.
        # If pull fails, abort with no impact on the running container.
        logger.info("Pre-pulling rollback image %s ...", image)
        code, _, err = await self._run(["pull", image], timeout=120)
        if code != 0:
            return {"success": False, "message": f"docker pull failed: {err.strip()}", "from_image": "", "to_image": image}

        # Snapshot running config before stopping so we can recreate with same flags.
        code, out, err = await self._run(["inspect", container])
        if code != 0:
            return {"success": False, "message": f"docker inspect failed: {err.strip()}", "from_image": "", "to_image": image}

        try:
            attrs = json.loads(out)[0]
            host_config = attrs.get("HostConfig", {})
            container_config = attrs.get("Config", {})
            from_image = container_config.get("Image", "unknown")
            network_mode = host_config.get("NetworkMode", "bridge")
            env_list: list[str] = container_config.get("Env") or []
            binds: list[str] = host_config.get("Binds") or []
            port_bindings: dict = host_config.get("PortBindings") or {}
        except Exception as exc:
            return {"success": False, "message": f"inspect parse failed: {exc}", "from_image": "", "to_image": image}

        # Stop and remove — image already local so downtime is minimal.
        await self._run(["stop", container])
        await self._run(["rm", container])

        cmd = ["run", "-d", "--name", container, "--network", network_mode]
        for e in env_list:
            cmd += ["-e", e]
        for b in binds:
            cmd += ["-v", b]
        for cport, hports in port_bindings.items():
            for hp in (hports or []):
                host = hp.get("HostPort", "")
                if host:
                    cmd += ["-p", f"{host}:{cport}"]
        cmd.append(image)

        code, _, err = await self._run(cmd)
        if code != 0:
            return {"success": False, "message": f"docker run failed: {err.strip()}", "from_image": from_image, "to_image": image}

        logger.info("Docker rollback complete: %s → %s", from_image, image)
        return {
            "success": True,
            "message": f"Rolled back {container}: {from_image} → {image}",
            "from_image": from_image,
            "to_image": image,
        }

    async def get_current_revision(self, name: str) -> int:
        return 0  # Docker has no revision concept
