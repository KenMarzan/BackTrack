"""
LSI Collector — Latent Semantic Indexing using SVD on TF-IDF log vectors.

Tails container logs in real time using Docker SDK log stream.
Collects first 200 log lines as training corpus for SVD fit.
Builds TF-IDF term-document matrix, applies TruncatedSVD (K=50).
Classifies each log line as INFO / WARN / ERROR / NOVEL via cosine similarity.
Computes LSI anomaly score per 30-second window.
"""
import asyncio
import collections
import logging
import time
from typing import Optional

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from src.config import config

logger = logging.getLogger("backtrack.lsi")

CORPUS_SIZE = 200  # Lines to collect before fitting SVD
WINDOW_SECONDS = 30
BASELINE_WINDOWS = 10

# Seed keywords for each log class
SEED_KEYWORDS = {
    "ERROR": ["error", "exception", "failed", "crash", "traceback", "fatal"],
    "WARN": ["warning", "deprecated", "slow", "retry", "timeout", "retrying"],
    "INFO": ["started", "ready", "connected", "success", "listening", "ok"],
}


class LSICollector:
    """Collects container logs, classifies them with SVD, and scores anomaly windows."""

    def __init__(self) -> None:
        self.vectorizer: Optional[TfidfVectorizer] = None
        self.svd: Optional[TruncatedSVD] = None
        self.centroids: dict[str, np.ndarray] = {}

        self.corpus: list[str] = []
        self.fitted = False

        # Current window tracking
        self.window_start: float = time.time()
        self.window_counts: dict[str, int] = {"INFO": 0, "WARN": 0, "ERROR": 0, "NOVEL": 0}
        self.window_total: int = 0

        # Score history for baseline
        self.score_history: list[float] = []
        self.baseline_scores: list[float] = []
        self.baseline_locked = False

        # Recent classified lines for the /lsi endpoint
        self.recent_lines: collections.deque[dict] = collections.deque(maxlen=50)

        self._running = False
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Start the background log tailing loop."""
        self._running = True
        self._task = asyncio.create_task(self._tail_loop())
        logger.info("LSI collector started (mode=%s)", config.mode)

    async def stop(self) -> None:
        """Stop the background log tailing loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("LSI collector stopped.")

    async def _tail_loop(self) -> None:
        """Tail container logs and classify each line."""
        if config.mode == "docker":
            await self._tail_docker()
        else:
            await self._tail_kubernetes()

    async def _tail_docker(self) -> None:
        """Tail logs from Docker container using Docker SDK."""
        try:
            import docker

            client = docker.from_env()
            container = client.containers.get(config.target)
            log_stream = container.logs(stream=True, follow=True, tail=0)

            for raw_line in log_stream:
                if not self._running:
                    break
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                await self._process_line(line)
                # Yield control to event loop periodically
                await asyncio.sleep(0)

        except Exception:
            logger.exception("Docker log tailing failed for target=%s", config.target)
            # Fall back to polling logs
            await self._poll_logs_fallback()

    async def _tail_kubernetes(self) -> None:
        """Tail logs from Kubernetes pods using kubectl."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "kubectl", "logs",
                "-n", config.k8s_namespace,
                "-l", config.k8s_label_selector,
                "--follow", "--tail=0",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            while self._running and proc.stdout:
                raw_line = await proc.stdout.readline()
                if not raw_line:
                    break
                line = raw_line.decode("utf-8", errors="replace").strip()
                if line:
                    await self._process_line(line)

        except Exception:
            logger.exception("K8s log tailing failed")
            await self._poll_logs_fallback()

    async def _poll_logs_fallback(self) -> None:
        """Fallback: periodically fetch the last N log lines."""
        while self._running:
            try:
                if config.mode == "docker":
                    import docker
                    client = docker.from_env()
                    container = client.containers.get(config.target)
                    logs = container.logs(tail=20).decode("utf-8", errors="replace")
                else:
                    proc = await asyncio.create_subprocess_exec(
                        "kubectl", "logs",
                        "-n", config.k8s_namespace,
                        "-l", config.k8s_label_selector,
                        "--tail=20",
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
                    logs = stdout.decode("utf-8", errors="replace")

                for line in logs.strip().splitlines():
                    line = line.strip()
                    if line:
                        await self._process_line(line)

            except Exception:
                logger.warning("Log poll fallback failed")

            await asyncio.sleep(WINDOW_SECONDS)

    async def _process_line(self, line: str) -> None:
        """Process a single log line: collect for corpus, classify, score."""
        # Phase 1: collect corpus
        if not self.fitted:
            self.corpus.append(line)
            if len(self.corpus) >= CORPUS_SIZE:
                self._fit()
            return

        # Phase 2: classify and score
        label = self._classify(line)
        self.window_counts[label] += 1
        self.window_total += 1
        self.recent_lines.append({
            "line": line[:500],
            "label": label,
            "timestamp": time.time(),
        })

        # Check if window has elapsed
        now = time.time()
        if now - self.window_start >= WINDOW_SECONDS:
            self._close_window()

    def _fit(self) -> None:
        """Fit TF-IDF + SVD on the collected corpus and compute seed centroids."""
        logger.info("Fitting LSI model on %d log lines...", len(self.corpus))
        try:
            self.vectorizer = TfidfVectorizer(max_features=5000)
            tfidf_matrix = self.vectorizer.fit_transform(self.corpus)

            n_components = min(50, tfidf_matrix.shape[1] - 1, tfidf_matrix.shape[0] - 1)
            if n_components < 1:
                logger.warning("Not enough features for SVD, using fallback")
                n_components = 1

            self.svd = TruncatedSVD(n_components=n_components, random_state=42)
            latent_matrix = self.svd.fit_transform(tfidf_matrix)

            # Compute centroids by matching seed keywords in corpus lines
            for label, keywords in SEED_KEYWORDS.items():
                matching_indices = []
                for i, line in enumerate(self.corpus):
                    lower = line.lower()
                    if any(kw in lower for kw in keywords):
                        matching_indices.append(i)

                if matching_indices:
                    self.centroids[label] = latent_matrix[matching_indices].mean(axis=0)
                else:
                    # Fallback: vectorize the keywords themselves
                    seed_vec = self.vectorizer.transform(keywords)
                    seed_latent = self.svd.transform(seed_vec)
                    self.centroids[label] = seed_latent.mean(axis=0)

            self.fitted = True
            logger.info("LSI model fitted. Centroids: %s", list(self.centroids.keys()))

        except Exception:
            logger.exception("LSI fit failed")

    def _classify(self, line: str) -> str:
        """Classify a single log line using cosine similarity to seed centroids."""
        if not self.vectorizer or not self.svd or not self.centroids:
            return "INFO"

        try:
            vec = self.vectorizer.transform([line])
            latent = self.svd.transform(vec)

            scores: dict[str, float] = {}
            for label, centroid in self.centroids.items():
                sim = cosine_similarity(latent, centroid.reshape(1, -1))[0][0]
                scores[label] = float(sim)

            best_label = max(scores, key=scores.get)  # type: ignore[arg-type]
            best_score = scores[best_label]

            return best_label if best_score > 0.25 else "NOVEL"

        except Exception:
            return "INFO"

    def _close_window(self) -> None:
        """Close the current 30-second scoring window."""
        if self.window_total == 0:
            score = 0.0
        else:
            e = self.window_counts.get("ERROR", 0)
            n = self.window_counts.get("NOVEL", 0)
            w = self.window_counts.get("WARN", 0)
            score = (e * 3 + n * 5 + w * 1) / self.window_total

        self.score_history.append(score)

        # Lock baseline after first BASELINE_WINDOWS clean windows
        if not self.baseline_locked and len(self.score_history) >= BASELINE_WINDOWS:
            self.baseline_scores = list(self.score_history[:BASELINE_WINDOWS])
            self.baseline_locked = True
            logger.info("LSI baseline locked: mean=%.4f", np.mean(self.baseline_scores))

        # Reset window
        self.window_start = time.time()
        self.window_counts = {"INFO": 0, "WARN": 0, "ERROR": 0, "NOVEL": 0}
        self.window_total = 0

    def is_anomalous(self) -> bool:
        """Returns True if current LSI score > 2× baseline mean."""
        if not self.baseline_locked or not self.score_history:
            return False
        baseline_mean = float(np.mean(self.baseline_scores))
        current_score = self.score_history[-1] if self.score_history else 0.0
        threshold = config.lsi_score_multiplier * baseline_mean
        if threshold <= 0:
            return False
        return current_score > threshold

    def get_lsi(self) -> dict:
        """Return LSI status for the /lsi endpoint."""
        current_score = self.score_history[-1] if self.score_history else 0.0
        baseline_mean = float(np.mean(self.baseline_scores)) if self.baseline_scores else 0.0

        return {
            "fitted": self.fitted,
            "corpus_size": len(self.corpus),
            "current_score": round(current_score, 4),
            "baseline_mean": round(baseline_mean, 4),
            "threshold": round(config.lsi_score_multiplier * baseline_mean, 4),
            "is_anomalous": self.is_anomalous(),
            "window_counts": dict(self.window_counts),
            "score_history": [round(s, 4) for s in self.score_history[-20:]],
            "recent_lines": list(self.recent_lines),
        }
