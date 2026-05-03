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
import json
import logging
import os
import re
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

        # Semantic analysis state (refreshed each window close)
        self.topics: list[dict] = []
        self.error_patterns: list[str] = []
        self.dominant_themes: list[str] = []
        self.log_diversity: str = "INSUFFICIENT"
        self.interpretation: str = ""

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

    async def _resolve_pod_name(self) -> Optional[str]:
        """Find a pod whose name contains the service name. More robust than label selectors."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "kubectl", "get", "pods",
                "-n", config.k8s_namespace,
                "--no-headers",
                "-o", "custom-columns=NAME:.metadata.name,STATUS:.status.phase",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
            if proc.returncode != 0:
                err = stderr.decode("utf-8", errors="replace").strip() if stderr else "no output"
                logger.warning("kubectl get pods failed for %s (rc=%d): %s",
                               self.service_name, proc.returncode, err[:300])
                return None
            needle = self.service_name.lower().replace(".", "-")
            for line in stdout.decode("utf-8", errors="replace").splitlines():
                parts = line.split()
                if len(parts) >= 1 and needle in parts[0].lower():
                    if len(parts) < 2 or parts[1].lower() == "running":
                        return parts[0]
            return None
        except Exception as exc:
            logger.warning("Pod resolution failed for %s: %s", self.service_name, exc)
            return None

    async def _tail_kubernetes(self) -> None:
        """Tail logs from Kubernetes pods. Resolves pod name first then tails by name."""
        # Initial snapshot: populate corpus quickly with last 200 lines
        await self._fetch_kubernetes_snapshot(tail=200)

        while self._running:
            pod_name = await self._resolve_pod_name()
            if not pod_name:
                logger.warning("No running pod found for %s — retrying in 5s", self.service_name)
                await asyncio.sleep(5)
                continue

            try:
                proc = await asyncio.create_subprocess_exec(
                    "kubectl", "logs",
                    pod_name,
                    "-n", config.k8s_namespace,
                    "--follow", "--tail=0",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                got_any_line = False
                while self._running and proc.stdout:
                    try:
                        raw_line = await asyncio.wait_for(proc.stdout.readline(), timeout=30)
                    except asyncio.TimeoutError:
                        break
                    if not raw_line:
                        break
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if line:
                        got_any_line = True
                        await self._process_line(line)

                if proc.returncode is None:
                    proc.kill()
                    await proc.wait()

                if proc.returncode is not None and proc.returncode != 0:
                    stderr_bytes = b""
                    try:
                        if proc.stderr:
                            stderr_bytes = await asyncio.wait_for(proc.stderr.read(), timeout=2)
                    except Exception:
                        pass
                    err = stderr_bytes.decode("utf-8", errors="replace").strip() if stderr_bytes else ""
                    logger.warning(
                        "kubectl logs exited (rc=%d) for %s/%s%s",
                        proc.returncode, self.service_name, pod_name,
                        f": {err[:300]}" if err else "",
                    )

                if not got_any_line and self._running:
                    # Pod might have restarted — refetch snapshot
                    await self._fetch_kubernetes_snapshot(tail=50)

            except Exception as exc:
                logger.warning("K8s log tail broke for %s: %s — retrying in 3s", self.service_name, exc)

            if self._running:
                await asyncio.sleep(3)

    async def _fetch_kubernetes_snapshot(self, tail: int = 100) -> None:
        """Fetch the last N log lines from any pod matching the service name."""
        try:
            pod_name = await self._resolve_pod_name()
            if not pod_name:
                return
            proc = await asyncio.create_subprocess_exec(
                "kubectl", "logs",
                pod_name,
                "-n", config.k8s_namespace,
                f"--tail={tail}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=20)
            if stdout:
                lines = stdout.decode("utf-8", errors="replace").splitlines()
                count = 0
                for raw in lines:
                    line = raw.strip()
                    if line:
                        await self._process_line(line)
                        count += 1
                logger.info("kubectl logs snapshot: %d lines from %s/%s",
                            count, self.service_name, pod_name)
            elif proc.returncode != 0:
                err = stderr.decode("utf-8", errors="replace").strip() if stderr else "no output"
                logger.warning("kubectl logs snapshot failed for %s/%s (rc=%d): %s",
                               self.service_name, pod_name, proc.returncode, err[:300])
        except Exception as exc:
            logger.warning("kubectl logs snapshot error for %s: %s", self.service_name, exc)

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
            if len(self.corpus) >= max(CORPUS_SIZE, 2):
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
        if len(self.corpus) < 2:
            logger.warning(
                "LSI corpus too small to fit (%d lines) — waiting for more logs",
                len(self.corpus),
            )
            return
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
        error_count = self.window_counts.get("ERROR", 0)
        warning_count = self.window_counts.get("WARN", 0)

        if self.window_total == 0:
            score = 0.0
        else:
            n = self.window_counts.get("NOVEL", 0)
            score = (error_count * 3 + n * 5 + warning_count * 1) / self.window_total

        self.score_history.append(score)

        # Lock baseline after first BASELINE_WINDOWS windows
        if not self.baseline_locked and len(self.score_history) >= BASELINE_WINDOWS:
            self.baseline_scores = list(self.score_history[:BASELINE_WINDOWS])
            self.baseline_locked = True
            logger.info("LSI baseline locked: mean=%.4f", np.mean(self.baseline_scores))
        elif self.baseline_locked and self.baseline_scores:
            # Gradually update baseline using only non-anomalous windows so it adapts
            # to normal log evolution without being corrupted by actual anomaly spikes.
            # Use same threshold logic as is_anomalous() for consistency.
            bm = float(np.mean(self.baseline_scores))
            current_threshold = 1.5 if bm <= 0 else config.lsi_score_multiplier * bm
            if score <= current_threshold:
                self.baseline_scores.append(score)
                self.baseline_scores = self.baseline_scores[-BASELINE_WINDOWS:]

        self._compute_semantics(error_count, warning_count, self.window_total)

        # Reset window
        self.window_start = time.time()
        self.window_counts = {"INFO": 0, "WARN": 0, "ERROR": 0, "NOVEL": 0}
        self.window_total = 0

    def _compute_semantics(self, error_count: int, warning_count: int, window_total: int) -> None:
        """Extract topics, error patterns, and human-readable interpretation after each window."""
        if not self.fitted or self.svd is None or self.vectorizer is None:
            return
        try:
            feature_names = self.vectorizer.get_feature_names_out()
            variance_ratios = self.svd.explained_variance_ratio_

            # Extract up to 5 topics from SVD components
            self.topics = []
            n_topics = min(5, len(self.svd.components_))
            for idx in range(n_topics):
                component = self.svd.components_[idx]
                top_idxs = component.argsort()[-5:][::-1]
                top_terms = [feature_names[i] for i in top_idxs]
                top_weights = [round(float(component[i]), 4) for i in top_idxs]
                strength = round(float(variance_ratios[idx]) if idx < len(variance_ratios) else 0.0, 4)
                self.topics.append({
                    "topic_id": idx,
                    "strength": strength,
                    "top_terms": top_terms,
                    "weights": top_weights,
                    "label": self._label_topic(top_terms),
                })

            # Complexity from top 2 components (mirrors TestBt.py n_topics=2 approach)
            complexity = float(np.sum(variance_ratios[:2])) if len(variance_ratios) >= 2 else float(np.sum(variance_ratios))

            if complexity > 0.7:
                self.log_diversity = "HIGH"
            elif complexity > 0.4:
                self.log_diversity = "MODERATE"
            elif window_total > 0:
                self.log_diversity = "LOW"
            else:
                self.log_diversity = "INSUFFICIENT"

            recent_texts = [entry["line"] for entry in self.recent_lines]
            self.error_patterns = self._extract_error_patterns(recent_texts, error_count, warning_count)
            self.dominant_themes = self._extract_dominant_themes(self.topics)

            if self.is_anomalous():
                status = "ANOMALY"
            elif (self.score_history and self.baseline_scores and
                    self.score_history[-1] > max(1.0, float(np.mean(self.baseline_scores)))):
                status = "WARNING"
            else:
                status = "STABLE"

            error_ratio = (error_count + warning_count * 0.5) / max(window_total, 1)
            self.interpretation = self._generate_interpretation(
                complexity, error_ratio, self.topics, self.error_patterns,
                self.dominant_themes, self.log_diversity, status,
            )

        except Exception:
            logger.warning("Semantic analysis failed for %s", self.service_name)

    @staticmethod
    def _label_topic(terms: list[str]) -> str:
        """Assign a semantic label to a topic based on its top terms."""
        lower = [t.lower() for t in terms]
        if any(t in lower for t in ["error", "exception", "failed", "failure", "panic"]):
            return "ERROR_HANDLING"
        if any(t in lower for t in ["connection", "timeout", "network", "socket", "http"]):
            return "NETWORK_OPERATIONS"
        if any(t in lower for t in ["database", "query", "sql", "postgres", "mysql", "redis"]):
            return "DATABASE_OPERATIONS"
        if any(t in lower for t in ["auth", "authentication", "token", "permission", "unauthorized"]):
            return "AUTHENTICATION"
        if any(t in lower for t in ["request", "response", "status", "code", "handler"]):
            return "REQUEST_HANDLING"
        if any(t in lower for t in ["latency", "slow", "performance", "memory", "cpu"]):
            return "PERFORMANCE"
        if any(t in lower for t in ["service", "client", "api", "endpoint", "call"]):
            return "SERVICE_INTEGRATION"
        return "GENERAL_OPERATIONS"

    @staticmethod
    def _extract_error_patterns(docs: list[str], error_count: int, warning_count: int) -> list[str]:
        """Detect known error patterns from a list of log lines."""
        known = {
            "connection refused": "Connection Refused - Dependency unavailable",
            "timeout":            "Timeout - Slow response or network issue",
            "out of memory":      "Out of Memory - Resource exhaustion",
            "null pointer":       "Null Pointer - Code defect",
            "permission denied":  "Permission Denied - Authorization issue",
            "not found":          "Not Found - Missing resource",
            "deadlock":           "Deadlock - Concurrency issue",
            "panic":              "Panic - Critical application crash",
            "500":                "HTTP 500 - Internal server error",
            "503":                "HTTP 503 - Service unavailable",
            "429":                "HTTP 429 - Rate limit exceeded",
        }
        combined = " ".join(docs).lower()
        found = [desc for pattern, desc in known.items() if pattern in combined]
        if error_count > 0 and not found:
            found.append(f"Unclassified Errors - {error_count} error entries found")
        return found[:5]

    @staticmethod
    def _extract_dominant_themes(topics: list[dict]) -> list[str]:
        """Return labels of the two strongest topics."""
        if not topics:
            return []
        return [t["label"] for t in sorted(topics, key=lambda t: t["strength"], reverse=True)[:2]]

    @staticmethod
    def _generate_interpretation(
        complexity: float, error_ratio: float,
        topics: list[dict], error_patterns: list[str],
        dominant_themes: list[str], log_diversity: str, status: str,
    ) -> str:
        """Generate a human-readable interpretation of the LSI semantic analysis."""
        parts: list[str] = []

        if log_diversity == "HIGH":
            parts.append(
                f"📊 Log Diversity: HIGH ({complexity:.2f}) - Logs show diverse patterns, "
                "indicating varied system behaviors or multiple concurrent issues."
            )
        elif log_diversity == "MODERATE":
            parts.append(
                f"📊 Log Diversity: MODERATE ({complexity:.2f}) - Logs show some variation, "
                "typical of normal operations with occasional events."
            )
        else:
            parts.append(
                f"📊 Log Diversity: LOW ({complexity:.2f}) - Logs are very uniform, "
                "indicating stable, repetitive operations or limited logging."
            )

        if error_ratio > 0.3:
            parts.append(
                f"🔴 Error Rate: CRITICAL ({error_ratio:.1%}) - Very high proportion of error messages. "
                "This strongly suggests active failures."
            )
        elif error_ratio > 0.1:
            parts.append(
                f"🟠 Error Rate: ELEVATED ({error_ratio:.1%}) - Notable number of errors detected. "
                "System is experiencing some failures."
            )
        elif error_ratio > 0.05:
            parts.append(
                f"🟡 Error Rate: MODERATE ({error_ratio:.1%}) - Some errors present but within "
                "potentially acceptable range for normal operations."
            )
        else:
            parts.append(f"🟢 Error Rate: LOW ({error_ratio:.1%}) - Minimal errors detected.")

        if dominant_themes:
            parts.append(
                f"🎯 Dominant Themes: {', '.join(dominant_themes)} - "
                "These operational areas are most prominent in recent logs."
            )

        if error_patterns:
            parts.append(
                "⚠️  Detected Issues:\n   " + "\n   ".join(f"• {p}" for p in error_patterns)
            )

        if topics:
            topic_lines = [
                f"   Topic {t['topic_id']} ({t['label']}, {t['strength']:.1%} variance): "
                + ", ".join(t["top_terms"][:3])
                for t in topics
            ]
            parts.append("📝 Topic Breakdown:\n" + "\n".join(topic_lines))

        if status == "ANOMALY":
            parts.append(
                "🚨 OVERALL: Log patterns are ANOMALOUS. Either high error rate, unusual diversity, "
                "or both indicate potential system issues requiring investigation."
            )
        elif status == "WARNING":
            parts.append(
                "⚠️  OVERALL: Log patterns show WARNING signals. Some deviation from normal "
                "but not yet critical. Continue monitoring."
            )
        else:
            parts.append("✅ OVERALL: Log patterns appear STABLE and within normal parameters.")

        return "\n\n".join(parts)

    def is_anomalous(self) -> bool:
        """Returns True if LSI score exceeds the configured threshold.

        When a baseline is established (baseline_mean > 0), the configured
        lsi_score_multiplier always governs — no hard floor bypass.  The ABS_FLOOR
        only applies when the baseline is zero (pure-INFO service with no history),
        so the multiplier threshold is never silently overridden by novel-log inflation.
        """
        if not self.baseline_locked or not self.score_history:
            return False
        baseline_mean = float(np.mean(self.baseline_scores))
        current_score = self.score_history[-1]
        if baseline_mean <= 0:
            # Safety net only: no meaningful baseline yet, use absolute floor
            return current_score > 1.5
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
            "threshold": round(1.5 if baseline_mean <= 0 else config.lsi_score_multiplier * baseline_mean, 4),
            "is_anomalous": self.is_anomalous(),
            "window_counts": dict(self.window_counts),
            "score_history": [round(s, 4) for s in self.score_history[-20:]],
            "recent_lines": list(self.recent_lines),
            "topics": self.topics,
            "error_patterns": self.error_patterns,
            "dominant_themes": self.dominant_themes,
            "log_diversity": self.log_diversity,
            "interpretation": self.interpretation,
            "evaluation": self.get_evaluation(),
        }
