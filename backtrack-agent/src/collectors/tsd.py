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

# ── Shared Docker stats cache ────────────────────────────────────────────────
# One `docker stats --no-stream` call serves all TSDCollectors instead of N calls.
_stats_cache: dict[str, dict[str, float]] = {}  # name → {cpu, mem_mb}
_stats_cache_at: float = 0.0
_stats_refresh_lock: Optional[asyncio.Lock] = None
_monitored_containers: set[str] = set()  # only stats these names, not all containers

_cluster_cpu_cores: float = 0.0  # total allocatable CPU cores across all nodes
_cluster_cpu_fetched_at: float = 0.0


async def _refresh_cluster_cpu() -> float:
    """Return total allocatable CPU cores across all nodes (cached for 5 minutes)."""
    global _cluster_cpu_cores, _cluster_cpu_fetched_at
    now = time.monotonic()
    if _cluster_cpu_cores > 0 and now - _cluster_cpu_fetched_at < 300:
        return _cluster_cpu_cores
    try:
        proc = await asyncio.create_subprocess_exec(
            "kubectl", "get", "nodes",
            "-o", "jsonpath={range .items[*]}{.status.allocatable.cpu}{'\\n'}{end}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        if proc.returncode == 0:
            total = 0.0
            for line in stdout.decode().strip().splitlines():
                line = line.strip()
                if not line:
                    continue
                if line.endswith("m"):
                    total += float(line[:-1]) / 1000.0
                else:
                    try:
                        total += float(line)
                    except ValueError:
                        pass
            if total > 0:
                _cluster_cpu_cores = total
                _cluster_cpu_fetched_at = now
    except Exception:
        pass
    return _cluster_cpu_cores if _cluster_cpu_cores > 0 else 1.0


def _get_stats_lock() -> asyncio.Lock:
    global _stats_refresh_lock
    if _stats_refresh_lock is None:
        _stats_refresh_lock = asyncio.Lock()
    return _stats_refresh_lock


async def _refresh_docker_stats(max_age: float = 5.0) -> None:
    """Refresh the shared stats cache (at most once per max_age seconds)."""
    global _stats_cache, _stats_cache_at
    now = time.monotonic()
    if now - _stats_cache_at < max_age:
        return
    async with _get_stats_lock():
        if time.monotonic() - _stats_cache_at < max_age:
            return  # another coroutine refreshed while we waited
        try:
            # Only stat the containers we're actually monitoring — avoids scanning
            # every container on the host which is slow when many are running.
            targets = list(_monitored_containers)
            cmd = ["docker", "stats", "--no-stream", "--format",
                   "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"] + targets
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15)
            if proc.returncode == 0:
                cache: dict[str, dict[str, float]] = {}
                for line in stdout.decode().strip().splitlines():
                    parts = line.split("\t")
                    if len(parts) < 3:
                        continue
                    name = parts[0].strip()
                    try:
                        cpu = float(parts[1].replace("%", "").strip())
                    except ValueError:
                        cpu = 0.0
                    mem_str = parts[2].split("/")[0].strip()
                    cache[name] = {"cpu": cpu, "mem_mb": _parse_mem_to_mb(mem_str)}
                _stats_cache = cache
                _stats_cache_at = time.monotonic()
        except Exception:
            logger.warning("docker stats refresh failed")


def _parse_mem_to_mb(raw: str) -> float:
    raw = raw.strip()
    for suffix, factor in (
        ("GiB", 1024.0), ("MiB", 1.0), ("kB", 1 / 1024.0),
        ("MB", 1.0), ("GB", 1024.0), ("KB", 1 / 1024.0), ("B", 1 / 1048576.0),
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
            "cpu": [], "memory": [], "latency": [], "error_rate": [],
        }
        self.seasonal: dict[str, list[float]] = {
            "cpu": [], "memory": [], "latency": [], "error_rate": [],
        }
        self.trend: dict[str, list[float]] = {
            "cpu": [], "memory": [], "latency": [], "error_rate": [],
        }

        self._total_readings: int = 0  # unbounded scrape counter for TN estimation

        # Drift event tracking for precision/recall estimation
        # sustained_drift = drift that persisted 3+ consecutive cycles (confirmed signal)
        # spike_drift = drift that appeared then resolved in <3 cycles (likely noise)
        self._drift_events_total: int = 0
        self._drift_sustained: int = 0   # confirmed: 3+ consecutive anomaly cycles
        self._drift_consecutive: int = 0  # current run length
        self._per_metric_drifts: dict[str, int] = {
            "cpu": 0, "memory": 0, "latency": 0, "error_rate": 0
        }

        # Modified Z-score analysis (per-metric, updated each decomposition cycle)
        self.z_scores: dict[str, float] = {
            "cpu": 0.0, "memory": 0.0, "latency": 0.0, "error_rate": 0.0,
        }
        self.trend_directions: dict[str, str] = {
            "cpu": "UNKNOWN", "memory": "UNKNOWN", "latency": "UNKNOWN", "error_rate": "UNKNOWN",
        }
        self.tsd_confidence: float = 0.0
        self.tsd_status: dict[str, str] = {
            "cpu": "INSUFFICIENT_DATA", "memory": "INSUFFICIENT_DATA",
            "latency": "INSUFFICIENT_DATA", "error_rate": "INSUFFICIENT_DATA",
        }

        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._docker_client = None  # reused across scrapes to avoid fd leak

    async def start(self) -> None:
        """Start the background collection loop."""
        self._running = True
        _monitored_containers.add(self.service_name)
        self._task = asyncio.create_task(self._collect_loop())
        logger.info("TSD collector started for %s (interval=%ds)", self.service_name, config.scrape_interval)

    async def stop(self) -> None:
        """Stop the background collection loop."""
        self._running = False
        _monitored_containers.discard(self.service_name)
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
                self._total_readings += 1
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
        """Read from the shared docker stats cache (one CLI call serves all collectors)."""
        await _refresh_docker_stats(max_age=config.scrape_interval * 0.8)
        entry = _stats_cache.get(self.service_name, {})
        self.current_cpu = entry.get("cpu", 0.0)
        self.current_memory = entry.get("mem_mb", 0.0)
        self.current_latency = await self._probe_latency()
        self.current_error_rate = 0.0

        self.cpu_history.append(self.current_cpu)
        self.memory_history.append(self.current_memory)
        self.latency_history.append(self.current_latency)
        self.error_rate_history.append(self.current_error_rate)

    async def _scrape_kubernetes(self) -> None:
        """Scrape metrics using kubectl top pods. Match by service name in pod name
        rather than relying on label selectors which may not match exactly."""
        try:
            # Fetch ALL pod metrics in the namespace, then filter by name match.
            # This is more robust than -l <selector> because:
            #  - Online Boutique-style pods may use multiple labels (app, app.kubernetes.io/name)
            #  - Selector mismatch silently returns nothing, hiding the issue
            proc = await asyncio.create_subprocess_exec(
                "kubectl", "top", "pods",
                "-n", config.k8s_namespace,
                "--no-headers",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
            if proc.returncode != 0:
                err = stderr.decode("utf-8", errors="replace").strip() if stderr else "no output"
                logger.warning(
                    "kubectl top failed for %s (rc=%d): %s — install metrics-server in your cluster",
                    self.service_name, proc.returncode, err[:300],
                )
            lines = stdout.decode().strip().splitlines()

            # Match pods whose name contains the service name (e.g. frontend-7b9c-abc → frontend)
            needle = self.service_name.lower().replace(".", "-")
            total_cpu = 0.0
            total_mem = 0.0
            count = 0
            for line in lines:
                parts = line.split()
                if len(parts) < 3:
                    continue
                pod_name = parts[0].lower()
                if needle not in pod_name:
                    continue
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

            if count > 0:
                cluster_cores = await _refresh_cluster_cpu()
                self.current_cpu = (total_cpu / cluster_cores) * 100.0
            else:
                self.current_cpu = 0.0
            self.current_memory = total_mem if count > 0 else 0.0
            self.current_latency = await self._probe_latency()
            self.current_error_rate = 0.0

        except Exception as exc:
            logger.warning("K8s metrics scrape failed for %s: %s", self.service_name, exc)
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
                self.seasonal[name] = result.seasonal.tolist()
                self.trend[name] = result.trend.tolist()
            except Exception:
                logger.warning("STL decomposition failed for %s", name)

        self._compute_z_scores()

    def _compute_z_scores(self) -> None:
        """Compute modified Z-scores, trend directions, and confidence per metric."""
        Z_THRESHOLD = 3.0
        self.tsd_confidence = round(min(1.0, len(self.cpu_history) / DEQUE_SIZE), 4)

        for name in ("cpu", "memory", "latency", "error_rate"):
            residuals = self.residuals.get(name, [])
            trend = self.trend.get(name, [])

            if len(residuals) < MIN_READINGS_FOR_STL:
                self.tsd_status[name] = "INSUFFICIENT_DATA"
                continue

            arr = np.array(residuals)
            median_val = float(np.median(arr))
            mad = float(np.median(np.abs(arr - median_val)))
            mod_z = 0.6745 * (arr[-1] - median_val) / (mad if mad > 1e-6 else 1e-6)
            self.z_scores[name] = round(float(mod_z), 4)

            if abs(mod_z) > Z_THRESHOLD:
                self.tsd_status[name] = "ANOMALY"
            elif abs(mod_z) > Z_THRESHOLD * 0.7:
                self.tsd_status[name] = "WARNING"
            else:
                self.tsd_status[name] = "STABLE"

            # Trend direction from last 6 points of the STL trend component
            if len(trend) >= 6:
                slope = (trend[-1] - trend[-6]) / 6
                if slope > 0.1:
                    self.trend_directions[name] = "INCREASING"
                elif slope < -0.1:
                    self.trend_directions[name] = "DECREASING"
                else:
                    self.trend_directions[name] = "STABLE"

    def is_drifting(self) -> bool:
        """
        Returns True if residual > 3×IQR for 3 consecutive readings
        on ANY metric. This is the core anomaly signal from TSD.
        Also detects flat-zero crashes: series was non-zero historically
        but recent readings dropped to near-zero (e.g. container crashed).
        """
        drifting_now = False

        # Raw-history anomaly detection: catches step changes that STL absorbs into trend.
        # Uses first half of the deque as the stable baseline (oldest = pre-fault readings).
        raw_histories: dict[str, list[float]] = {
            "cpu": list(self.cpu_history),
            "memory": list(self.memory_history),
        }
        for name, series in raw_histories.items():
            if len(series) < MIN_READINGS_FOR_STL:
                continue

            n = len(series)
            baseline_window = max(6, n // 2)
            baseline_series = series[:baseline_window]  # oldest readings = pre-fault
            recent = series[-3:]

            hist_mean = float(np.mean(baseline_series))
            hist_q1, hist_q3 = float(np.percentile(baseline_series, 25)), float(np.percentile(baseline_series, 75))
            hist_iqr = hist_q3 - hist_q1
            hist_std = float(np.std(baseline_series))
            spread = max(hist_iqr, hist_std, 0.01)

            # Flat-zero crash: was active, now near-zero
            if hist_mean > 1.0 and all(v < 0.01 for v in recent):
                logger.warning(
                    "TSD FLAT-ZERO DRIFT on %s: baseline_mean=%.2f dropped to near-zero %s",
                    name, hist_mean, [round(v, 4) for v in recent],
                )
                self._per_metric_drifts[name] = self._per_metric_drifts.get(name, 0) + 1
                drifting_now = True

            # Spike detection: recent readings are far above baseline (sustained step-up)
            spike_threshold = hist_mean + 5.0 * spread
            if spike_threshold > 0 and all(v > spike_threshold for v in recent):
                logger.warning(
                    "TSD SPIKE DRIFT on %s: baseline_mean=%.2f recent=%s threshold=%.2f",
                    name, hist_mean, [round(v, 2) for v in recent], spike_threshold,
                )
                self._per_metric_drifts[name] = self._per_metric_drifts.get(name, 0) + 1
                drifting_now = True

        for name, residuals in self.residuals.items():
            if len(residuals) < 6:
                continue
            baseline = residuals[:-3]
            if len(baseline) < 3:
                continue
            q1, q3 = np.percentile(baseline, [25, 75])
            iqr = q3 - q1
            if iqr < 1e-6:
                continue
            threshold = config.tsd_iqr_multiplier * iqr
            last_three = residuals[-3:]
            if all(abs(r) > threshold for r in last_three):
                logger.warning(
                    "TSD DRIFT on %s: last 3 residuals %s exceed threshold %.4f",
                    name, [round(r, 4) for r in last_three], threshold,
                )
                self._per_metric_drifts[name] = self._per_metric_drifts.get(name, 0) + 1
                drifting_now = True

        if drifting_now:
            self._drift_consecutive += 1
            if self._drift_consecutive == 1:
                self._drift_events_total += 1
            if self._drift_consecutive >= 3:
                self._drift_sustained += 1
        else:
            self._drift_consecutive = 0

        return drifting_now

    def get_evaluation(self) -> dict:
        """Drift detection quality estimates (no ground truth — uses heuristics)."""
        total = self._drift_events_total
        sustained = self._drift_sustained
        spikes = max(0, total - sustained)
        est_precision = sustained / total if total > 0 else 0.0

        # TN estimated as scrape cycles where no drift was detected at all
        tn = max(0, self._total_readings - total)

        return {
            "drift_events_total": total,
            "drift_sustained": sustained,
            "drift_spikes": spikes,
            "total_readings": self._total_readings,
            "estimated_precision": round(est_precision, 4),
            "per_metric_drifts": dict(self._per_metric_drifts),
            "confusion_matrix": {
                "TP_sustained": sustained,
                "FP_spikes": spikes,
                "TN_clean_cycles": tn,
                "note": "FN unknown without fault injection ground truth",
            },
        }

    def get_metrics(self) -> dict:
        """Return current readings, STL decomposition, drift status for /metrics endpoint."""
        def _r(vals: list[float], n: int = 4) -> list[float]:
            return [round(v, n) for v in vals]

        # Map internal short keys → frontend field names
        key_map = {
            "cpu": "cpu_percent",
            "memory": "memory_mb",
            "latency": "latency_ms",
            "error_rate": "error_rate_percent",
        }

        decomposition: dict = {}
        for short, full in key_map.items():
            if self.residuals.get(short):
                decomposition[full] = {
                    "seasonal": _r(self.seasonal.get(short, [])),
                    "trend":    _r(self.trend.get(short, [])),
                    "residual": _r(self.residuals.get(short, [])),
                }

        return {
            "current": {
                "cpu_percent":        round(self.current_cpu, 3),
                "memory_mb":          round(self.current_memory, 2),
                "latency_ms":         round(self.current_latency, 2),
                "error_rate_percent": round(self.current_error_rate, 3),
            },
            "history": {
                "cpu":        _r(list(self.cpu_history), 3),
                "memory":     _r(list(self.memory_history), 2),
                "latency":    _r(list(self.latency_history), 2),
                "error_rate": _r(list(self.error_rate_history), 3),
            },
            "decomposition": decomposition,
            "residuals": {k: _r(v) for k, v in self.residuals.items()},
            "readings_count": len(self.cpu_history),
            "is_drifting": self.is_drifting(),
            "z_scores": dict(self.z_scores),
            "trend_directions": dict(self.trend_directions),
            "tsd_confidence": self.tsd_confidence,
            "tsd_status": dict(self.tsd_status),
            "evaluation": self.get_evaluation(),
        }
