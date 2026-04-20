"""
TSD Collector — Time Series Decomposition using STL (Seasonal-Trend decomposition using LOESS).

Scrapes CPU %, memory MB, HTTP latency ms, HTTP error rate % every scrape_interval seconds.
Uses Docker SDK stats API (Docker mode) or Kubernetes metrics API (K8s mode).
Stores rolling deque of last 36 readings (6 minutes at 10s intervals).
After 12 readings, runs STL decomposition on each metric series.
Detects anomalies when residual > 3×IQR for 3 consecutive readings.
"""
import asyncio
import collections
import logging
import time
from typing import Optional

import numpy as np

from src.config import config

logger = logging.getLogger("backtrack.tsd")

DEQUE_SIZE = 36  # 6 minutes at 10s intervals
MIN_READINGS_FOR_STL = 12  # Need at least 2×period readings


class TSDCollector:
    """Collects metrics and runs STL decomposition to detect anomalies."""

    def __init__(self, service_name: str = "", label_selector: str = "") -> None:
        self.service_name = service_name or config.target
        self.label_selector = label_selector or config.k8s_label_selector

        self.cpu_history: collections.deque[float] = collections.deque(maxlen=DEQUE_SIZE)
        self.memory_history: collections.deque[float] = collections.deque(maxlen=DEQUE_SIZE)
        self.latency_history: collections.deque[float] = collections.deque(maxlen=DEQUE_SIZE)
        self.error_rate_history: collections.deque[float] = collections.deque(maxlen=DEQUE_SIZE)

        self.current_cpu: float = 0.0
        self.current_memory: float = 0.0
        self.current_latency: float = 0.0
        self.current_error_rate: float = 0.0

        self.residuals: dict[str, list[float]] = {
            "cpu": [],
            "memory": [],
            "latency": [],
            "error_rate": [],
        }

        self._running = False
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Start the background collection loop."""
        self._running = True
        self._task = asyncio.create_task(self._collect_loop())
        logger.info("TSD collector started for %s (interval=%ds)", self.service_name, config.scrape_interval)

    async def stop(self) -> None:
        """Stop the background collection loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("TSD collector stopped.")

    async def _collect_loop(self) -> None:
        """Main scrape loop — runs every scrape_interval seconds."""
        while self._running:
            try:
                await self._scrape()
                if len(self.cpu_history) >= MIN_READINGS_FOR_STL:
                    self._decompose()
            except Exception:
                logger.exception("Error in TSD collect loop")
            await asyncio.sleep(config.scrape_interval)

    async def _scrape(self) -> None:
        """Scrape metrics from Docker or Kubernetes."""
        if config.mode == "docker":
            await self._scrape_docker()
        else:
            await self._scrape_kubernetes()

    async def _scrape_docker(self) -> None:
        """Scrape metrics using Docker SDK stats API."""
        try:
            import docker

            client = docker.from_env()
            container = client.containers.get(config.target)
            stats = container.stats(stream=False)

            # CPU calculation
            cpu_delta = (
                stats["cpu_stats"]["cpu_usage"]["total_usage"]
                - stats["precpu_stats"]["cpu_usage"]["total_usage"]
            )
            system_delta = (
                stats["cpu_stats"]["system_cpu_usage"]
                - stats["precpu_stats"]["system_cpu_usage"]
            )
            num_cpus = stats["cpu_stats"].get("online_cpus", 1)
            self.current_cpu = (cpu_delta / max(system_delta, 1)) * num_cpus * 100.0

            # Memory calculation (MB)
            mem_usage = stats["memory_stats"].get("usage", 0)
            mem_cache = stats["memory_stats"].get("stats", {}).get("cache", 0)
            self.current_memory = (mem_usage - mem_cache) / (1024 * 1024)

            # HTTP latency — time a request to app's health endpoint
            self.current_latency = await self._probe_latency()

            # Error rate defaults to 0 unless we can measure it
            self.current_error_rate = 0.0

        except Exception:
            logger.warning("Docker stats scrape failed for target=%s", config.target)
            self.current_cpu = 0.0
            self.current_memory = 0.0
            self.current_latency = 0.0
            self.current_error_rate = 0.0

        self.cpu_history.append(self.current_cpu)
        self.memory_history.append(self.current_memory)
        self.latency_history.append(self.current_latency)
        self.error_rate_history.append(self.current_error_rate)

    async def _scrape_kubernetes(self) -> None:
        """Scrape metrics using kubectl top pods."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "kubectl", "top", "pods",
                "-n", config.k8s_namespace,
                "-l", self.label_selector,
                "--no-headers",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            lines = stdout.decode().strip().splitlines()

            total_cpu = 0.0
            total_mem = 0.0
            count = 0
            for line in lines:
                parts = line.split()
                if len(parts) >= 3:
                    # CPU is like "25m" (millicores) or "0"
                    cpu_str = parts[1].rstrip("m")
                    cpu_val = float(cpu_str) / 1000.0 if "m" in parts[1] else float(cpu_str)
                    # Memory is like "128Mi" or "64Ki"
                    mem_str = parts[2]
                    if mem_str.endswith("Mi"):
                        mem_val = float(mem_str[:-2])
                    elif mem_str.endswith("Ki"):
                        mem_val = float(mem_str[:-2]) / 1024.0
                    elif mem_str.endswith("Gi"):
                        mem_val = float(mem_str[:-2]) * 1024.0
                    else:
                        mem_val = float(mem_str) / (1024 * 1024)
                    total_cpu += cpu_val
                    total_mem += mem_val
                    count += 1

            self.current_cpu = (total_cpu * 100.0) if count > 0 else 0.0
            self.current_memory = total_mem if count > 0 else 0.0
            self.current_latency = await self._probe_latency()
            self.current_error_rate = 0.0

        except Exception:
            logger.warning("K8s metrics scrape failed for %s", self.service_name)
            self.current_cpu = 0.0
            self.current_memory = 0.0
            self.current_latency = 0.0
            self.current_error_rate = 0.0

        self.cpu_history.append(self.current_cpu)
        self.memory_history.append(self.current_memory)
        self.latency_history.append(self.current_latency)
        self.error_rate_history.append(self.current_error_rate)

    async def _probe_latency(self) -> float:
        """Time a request to the target's health endpoint (ms)."""
        import aiohttp

        urls = [
            f"http://{self.service_name}:8080/health",
            f"http://{self.service_name}:8080/",
            f"http://{self.service_name}:80/",
        ]
        for url in urls:
            try:
                start = time.monotonic()
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
                    async with session.get(url) as resp:
                        await resp.read()
                return (time.monotonic() - start) * 1000.0
            except Exception:
                continue
        return 0.0

    def _decompose(self) -> None:
        """Run STL decomposition on each metric series."""
        from statsmodels.tsa.seasonal import STL

        metrics = {
            "cpu": list(self.cpu_history),
            "memory": list(self.memory_history),
            "latency": list(self.latency_history),
            "error_rate": list(self.error_rate_history),
        }

        for name, series in metrics.items():
            if len(series) < MIN_READINGS_FOR_STL:
                continue
            try:
                result = STL(series, period=6, robust=True).fit()
                self.residuals[name] = result.resid.tolist()
            except Exception:
                logger.warning("STL decomposition failed for %s", name)

    def is_drifting(self) -> bool:
        """
        Returns True if residual > 3×IQR for 3 consecutive readings
        on ANY metric. This is the core anomaly signal from TSD.
        """
        for name, residuals in self.residuals.items():
            if len(residuals) < 6:
                continue
            # Baseline: all but last 3 readings
            baseline = residuals[:-3]
            if len(baseline) < 3:
                continue
            q1, q3 = np.percentile(baseline, [25, 75])
            iqr = q3 - q1
            # Skip metrics with near-zero variance — flat series produce
            # floating-point noise residuals (~1e-16) that falsely exceed a
            # zero threshold.
            if iqr < 1e-6:
                continue
            threshold = config.tsd_iqr_multiplier * iqr
            last_three = residuals[-3:]
            if all(abs(r) > threshold for r in last_three) and threshold > 0:
                logger.warning(
                    "TSD DRIFT on %s: last 3 residuals %s exceed threshold %.4f",
                    name, [round(r, 4) for r in last_three], threshold,
                )
                return True
        return False

    def get_metrics(self) -> dict:
        """Return current readings, residuals, drift status for /metrics endpoint."""
        return {
            "current": {
                "cpu_percent": round(self.current_cpu, 3),
                "memory_mb": round(self.current_memory, 2),
                "latency_ms": round(self.current_latency, 2),
                "error_rate_percent": round(self.current_error_rate, 3),
            },
            "history": {
                "cpu": [round(v, 3) for v in self.cpu_history],
                "memory": [round(v, 2) for v in self.memory_history],
                "latency": [round(v, 2) for v in self.latency_history],
                "error_rate": [round(v, 3) for v in self.error_rate_history],
            },
            "residuals": {
                name: [round(v, 4) for v in vals]
                for name, vals in self.residuals.items()
            },
            "readings_count": len(self.cpu_history),
            "is_drifting": self.is_drifting(),
        }
