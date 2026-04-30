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
import os
import time
from typing import Optional

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from src.config import config

logger = logging.getLogger("backtrack.lsi")

CORPUS_SIZE = int(os.getenv("BACKTRACK_CORPUS_SIZE", "200"))
WINDOW_SECONDS = int(os.getenv("BACKTRACK_WINDOW_SECONDS", "30"))
BASELINE_WINDOWS = int(os.getenv("BACKTRACK_BASELINE_WINDOWS", "10"))
SVD_SIMILARITY_THRESHOLD = float(os.getenv("BACKTRACK_SVD_SIMILARITY_THRESHOLD", "0.55"))

# Seed keywords for each log class
SEED_KEYWORDS = {
    "ERROR": ["error", "exception", "failed", "crash", "traceback", "fatal"],
    "WARN": ["warning", "deprecated", "slow", "retry", "timeout", "retrying"],
    "INFO": ["started", "ready", "connected", "success", "listening", "ok"],
}


class LSICollector:
    """Collects container logs, classifies them with SVD, and scores anomaly windows."""

    def __init__(self, service_name: str = "", label_selector: str = "") -> None:
        self.service_name = service_name or config.target
        self.label_selector = label_selector or config.k8s_label_selector
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

        # Confusion matrix: keyword label (reference) vs SVD label (predicted)
        # Only populated for lines where keyword gave a definitive label AND SVD ran
        # rows = reference class, cols = predicted class
        _classes = ["INFO", "WARN", "ERROR", "NOVEL"]
        self._confusion: dict[str, dict[str, int]] = {
            ref: {pred: 0 for pred in _classes} for ref in _classes
        }
        self._svd_classified_count: int = 0  # lines that went through SVD path

        self._running = False
        self._task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Start the background log tailing loop."""
        self._running = True
        self._task = asyncio.create_task(self._tail_loop())
        logger.info("LSI collector started for %s (mode=%s)", self.service_name, config.mode)

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
            container = client.containers.get(self.service_name)
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
            logger.exception("Docker log tailing failed for target=%s", self.service_name)
            # Fall back to polling logs
            await self._poll_logs_fallback()

    async def _tail_kubernetes(self) -> None:
        """Tail logs from Kubernetes pods using kubectl. Retries on stream break."""
        while self._running:
            try:
                proc = await asyncio.create_subprocess_exec(
                    "kubectl", "logs",
                    "-n", config.k8s_namespace,
                    "-l", self.label_selector,
                    "--follow", "--tail=50",
                    "--prefix",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                while self._running and proc.stdout:
                    try:
                        raw_line = await asyncio.wait_for(proc.stdout.readline(), timeout=15)
                    except asyncio.TimeoutError:
                        break
                    if not raw_line:
                        break
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if line:
                        await self._process_line(line)

                if proc.returncode is None:
                    proc.kill()
                    await proc.wait()

            except Exception:
                logger.warning("K8s log tail broke for %s — retrying in 3s", self.service_name)

            if self._running:
                await asyncio.sleep(3)

    async def _poll_logs_fallback(self) -> None:
        """Fallback: periodically fetch the last N log lines."""
        while self._running:
            try:
                if config.mode == "docker":
                    import docker
                    client = docker.from_env()
                    container = client.containers.get(self.service_name)
                    logs = container.logs(tail=20).decode("utf-8", errors="replace")
                else:
                    proc = await asyncio.create_subprocess_exec(
                        "kubectl", "logs",
                        "-n", config.k8s_namespace,
                        "-l", self.label_selector,
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

            await asyncio.sleep(max(5, WINDOW_SECONDS // 3))

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

    def _keyword_classify(self, line: str) -> Optional[str]:
        """Fast-path: return ERROR/WARN if seed keywords hit, else None for SVD path."""
        lower = line.lower()
        for label in ("ERROR", "WARN"):
            if any(kw in lower for kw in SEED_KEYWORDS[label]):
                return label
        return None

    def _classify(self, line: str) -> str:
        """Classify a single log line. Keyword pre-check, then SVD cosine similarity."""
        kw = self._keyword_classify(line)

        if not self.vectorizer or not self.svd or not self.centroids:
            return kw or "INFO"

        try:
            vec = self.vectorizer.transform([line])
            latent = self.svd.transform(vec)

            scores: dict[str, float] = {}
            for label, centroid in self.centroids.items():
                sim = cosine_similarity(latent, centroid.reshape(1, -1))[0][0]
                scores[label] = float(sim)

            best_label = max(scores, key=scores.get)  # type: ignore[arg-type]
            best_score = scores[best_label]
            svd_label = best_label if best_score > SVD_SIMILARITY_THRESHOLD else "NOVEL"

            self._svd_classified_count += 1

            # Build confusion matrix: keyword = reference, SVD = predicted
            # For lines with no keyword match, treat SVD result as INFO reference baseline
            ref = kw if kw else "INFO"
            self._confusion[ref][svd_label] += 1

            # If keyword matched, return keyword (fast path takes priority)
            return kw if kw else svd_label

        except Exception:
            return kw or "INFO"

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
        """Returns True if LSI score exceeds relative or absolute threshold."""
        if not self.baseline_locked or not self.score_history:
            return False
        baseline_mean = float(np.mean(self.baseline_scores))
        current_score = self.score_history[-1] if self.score_history else 0.0
        # Absolute floor so a high-error rate is always caught even with inflated baseline
        ABS_FLOOR = 1.5
        if current_score > ABS_FLOOR:
            return True
        if baseline_mean <= 0:
            return False
        return current_score > config.lsi_score_multiplier * baseline_mean

    def get_evaluation(self) -> dict:
        """Compute confusion matrix + precision/recall/F1 per class (keyword vs SVD)."""
        classes = ["INFO", "WARN", "ERROR", "NOVEL"]
        matrix = self._confusion
        metrics: dict[str, dict] = {}

        for cls in classes:
            tp = matrix[cls][cls]
            fp = sum(matrix[ref][cls] for ref in classes if ref != cls)
            fn = sum(matrix[cls][pred] for pred in classes if pred != cls)
            tn = sum(
                matrix[ref][pred]
                for ref in classes for pred in classes
                if ref != cls and pred != cls
            )
            precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            f1 = (2 * precision * recall / (precision + recall)
                  if (precision + recall) > 0 else 0.0)
            metrics[cls] = {
                "precision": round(precision, 4),
                "recall": round(recall, 4),
                "f1": round(f1, 4),
                "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            }

        return {
            "confusion_matrix": {
                ref: dict(row) for ref, row in matrix.items()
            },
            "per_class": metrics,
            "svd_classified_total": self._svd_classified_count,
            "classes": classes,
        }

    def get_lsi(self) -> dict:
        """Return LSI status for the /lsi endpoint."""
        current_score = self.score_history[-1] if self.score_history else 0.0
        baseline_mean = float(np.mean(self.baseline_scores)) if self.baseline_scores else 0.0

        return {
            "fitted": self.fitted,
            "corpus_size": len(self.corpus),
            "current_score": round(current_score, 4),
            "baseline_mean": round(baseline_mean, 4),
            "threshold": round(max(1.5, config.lsi_score_multiplier * baseline_mean), 4),
            "is_anomalous": self.is_anomalous(),
            "window_counts": dict(self.window_counts),
            "score_history": [round(s, 4) for s in self.score_history[-20:]],
            "recent_lines": list(self.recent_lines),
            "evaluation": self.get_evaluation(),
        }
