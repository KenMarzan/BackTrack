import asyncio
from unittest.mock import patch

import pytest
from src.collectors.lsi import BASELINE_WINDOWS, CORPUS_SIZE, LSICollector


@pytest.fixture(autouse=True)
def mock_config():
    with patch("src.collectors.lsi.config") as cfg:
        cfg.target = "test-service"
        cfg.k8s_label_selector = "app=test"
        cfg.mode = "docker"
        cfg.lsi_score_multiplier = 2.0
        yield cfg


def make_fitted_collector() -> LSICollector:
    """Build a collector with a real fitted model using synthetic log lines."""
    collector = LSICollector(service_name="test")
    corpus = (
        ["error exception failed crash"] * 50
        + ["warning deprecated slow retry"] * 50
        + ["started ready connected success"] * 50
        + ["random log line number " + str(i) for i in range(50)]
    )
    collector.corpus = corpus
    collector._fit()
    return collector


# --- _fit ---


def test_fit_marks_fitted():
    collector = make_fitted_collector()
    assert collector.fitted
    assert collector.vectorizer is not None
    assert collector.svd is not None
    assert set(collector.centroids.keys()) == {"ERROR", "WARN", "INFO"}


# --- _classify ---


def test_classify_error_line():
    collector = make_fitted_collector()
    assert collector._classify("error exception failed") == "ERROR"


def test_classify_warn_line():
    collector = make_fitted_collector()
    assert collector._classify("warning deprecated slow") == "WARN"


def test_classify_info_line():
    collector = make_fitted_collector()
    assert collector._classify("started ready connected success") == "INFO"


def test_classify_before_fit_returns_info():
    collector = LSICollector(service_name="test")
    assert collector._classify("anything here") == "INFO"


# --- _close_window ---


def test_close_window_computes_score():
    collector = make_fitted_collector()
    # score = (ERROR*3 + NOVEL*5 + WARN*1) / total = (1*3 + 0*5 + 2*1) / 3 = 5/3
    collector.window_counts = {"INFO": 0, "WARN": 2, "ERROR": 1, "NOVEL": 0}
    collector.window_total = 3
    collector._close_window()
    assert abs(collector.score_history[-1] - 5 / 3) < 1e-9


def test_close_window_zero_total_gives_zero_score():
    collector = make_fitted_collector()
    collector.window_total = 0
    collector._close_window()
    assert collector.score_history[-1] == 0.0


def test_close_window_resets_counts():
    collector = make_fitted_collector()
    collector.window_counts = {"INFO": 5, "WARN": 1, "ERROR": 2, "NOVEL": 1}
    collector.window_total = 9
    collector._close_window()
    assert collector.window_total == 0
    assert all(v == 0 for v in collector.window_counts.values())


# --- baseline locking ---


def test_baseline_locks_after_n_windows():
    collector = make_fitted_collector()
    for _ in range(BASELINE_WINDOWS):
        collector.window_counts["INFO"] = 10
        collector.window_total = 10
        collector._close_window()
    assert collector.baseline_locked
    assert len(collector.baseline_scores) == BASELINE_WINDOWS


def test_baseline_does_not_lock_before_n_windows():
    collector = make_fitted_collector()
    for _ in range(BASELINE_WINDOWS - 1):
        collector.window_total = 10
        collector.window_counts["INFO"] = 10
        collector._close_window()
    assert not collector.baseline_locked


# --- is_anomalous ---


def test_is_anomalous_false_before_baseline():
    collector = make_fitted_collector()
    assert not collector.is_anomalous()


def test_is_anomalous_false_when_score_within_threshold():
    collector = make_fitted_collector()
    collector.baseline_scores = [1.0] * BASELINE_WINDOWS
    collector.baseline_locked = True
    collector.score_history = [1.5]  # 1.5 < 2.0 * 1.0
    assert not collector.is_anomalous()


def test_is_anomalous_true_when_score_exceeds_threshold():
    collector = make_fitted_collector()
    collector.baseline_scores = [1.0] * BASELINE_WINDOWS
    collector.baseline_locked = True
    collector.score_history = [3.0]  # 3.0 > 2.0 * 1.0
    assert collector.is_anomalous()


def test_is_anomalous_false_when_baseline_mean_is_zero():
    collector = make_fitted_collector()
    collector.baseline_scores = [0.0] * BASELINE_WINDOWS
    collector.baseline_locked = True
    # Score must be below the absolute floor (1.5) so that floor doesn't fire first;
    # the zero-guard (baseline_mean <= 0 → False) is what we're testing here.
    collector.score_history = [0.5]
    assert not collector.is_anomalous()


# --- get_lsi ---


def test_get_lsi_structure():
    collector = make_fitted_collector()
    result = collector.get_lsi()
    assert result["fitted"] is True
    assert result["corpus_size"] > 0  # exact size depends on make_fitted_collector, not CORPUS_SIZE env var
    for key in (
        "current_score",
        "baseline_mean",
        "threshold",
        "is_anomalous",
        "window_counts",
        "score_history",
        "recent_lines",
        "topics",
        "error_patterns",
        "dominant_themes",
        "log_diversity",
        "interpretation",
    ):
        assert key in result


def test_get_lsi_before_fit():
    collector = LSICollector(service_name="test")
    result = collector.get_lsi()
    assert result["fitted"] is False
    assert result["corpus_size"] == 0
    assert result["current_score"] == 0.0


# --- _process_line (async) ---


async def test_process_line_accumulates_corpus():
    collector = LSICollector(service_name="test")
    await collector._process_line("some log line")
    assert len(collector.corpus) == 1
    assert not collector.fitted


async def test_process_line_triggers_fit_at_corpus_size():
    collector = LSICollector(service_name="test")
    # Send exactly CORPUS_SIZE - 1 varied lines so fit hasn't triggered yet
    labels = ["error exception failed", "warning deprecated slow", "started ready connected", "random info log"]
    for i in range(CORPUS_SIZE - 1):
        await collector._process_line(labels[i % len(labels)] + f" {i}")
    assert not collector.fitted
    await collector._process_line("final triggering line")
    assert collector.fitted


async def test_process_line_after_fit_adds_to_recent_lines():
    collector = make_fitted_collector()
    await collector._process_line("error something crashed")
    assert len(collector.recent_lines) == 1
    entry = collector.recent_lines[0]
    assert "line" in entry and "label" in entry and "timestamp" in entry


# --- _label_topic ---


def test_label_topic_error_handling():
    assert LSICollector._label_topic(["error", "exception", "fatal"]) == "ERROR_HANDLING"


def test_label_topic_network():
    assert LSICollector._label_topic(["connection", "socket", "timeout"]) == "NETWORK_OPERATIONS"


def test_label_topic_database():
    assert LSICollector._label_topic(["database", "query", "postgres"]) == "DATABASE_OPERATIONS"


def test_label_topic_auth():
    assert LSICollector._label_topic(["auth", "token", "unauthorized"]) == "AUTHENTICATION"


def test_label_topic_request():
    assert LSICollector._label_topic(["request", "response", "handler"]) == "REQUEST_HANDLING"


def test_label_topic_performance():
    assert LSICollector._label_topic(["latency", "slow", "cpu"]) == "PERFORMANCE"


def test_label_topic_service():
    assert LSICollector._label_topic(["service", "api", "endpoint"]) == "SERVICE_INTEGRATION"


def test_label_topic_fallback():
    assert LSICollector._label_topic(["foo", "bar", "baz"]) == "GENERAL_OPERATIONS"


# --- _extract_error_patterns ---


def test_extract_error_patterns_timeout():
    patterns = LSICollector._extract_error_patterns(["connection timeout occurred"], 1, 0)
    assert any("Timeout" in p for p in patterns)


def test_extract_error_patterns_connection_refused():
    patterns = LSICollector._extract_error_patterns(["connection refused by server"], 1, 0)
    assert any("Connection Refused" in p for p in patterns)


def test_extract_error_patterns_http_500():
    patterns = LSICollector._extract_error_patterns(["returned status 500 internal error"], 0, 0)
    assert any("500" in p for p in patterns)


def test_extract_error_patterns_unclassified():
    patterns = LSICollector._extract_error_patterns(["some vague error"], 3, 0)
    assert any("Unclassified" in p for p in patterns)


def test_extract_error_patterns_capped_at_five():
    # trigger all 11 patterns by including all keywords
    doc = "connection refused timeout out of memory null pointer permission denied not found deadlock panic 500 503 429"
    patterns = LSICollector._extract_error_patterns([doc], 0, 0)
    assert len(patterns) <= 5


# --- _extract_dominant_themes ---


def test_extract_dominant_themes_returns_top_two():
    topics = [
        {"label": "NETWORK_OPERATIONS", "strength": 0.1},
        {"label": "ERROR_HANDLING",     "strength": 0.5},
        {"label": "REQUEST_HANDLING",   "strength": 0.3},
    ]
    themes = LSICollector._extract_dominant_themes(topics)
    assert themes == ["ERROR_HANDLING", "REQUEST_HANDLING"]


def test_extract_dominant_themes_empty():
    assert LSICollector._extract_dominant_themes([]) == []


# --- _generate_interpretation ---


def test_generate_interpretation_stable():
    result = LSICollector._generate_interpretation(
        complexity=0.3, error_ratio=0.01, topics=[], error_patterns=[],
        dominant_themes=[], log_diversity="LOW", status="STABLE",
    )
    assert "STABLE" in result


def test_generate_interpretation_anomaly():
    result = LSICollector._generate_interpretation(
        complexity=0.8, error_ratio=0.4, topics=[], error_patterns=["Timeout - Slow response"],
        dominant_themes=["ERROR_HANDLING"], log_diversity="HIGH", status="ANOMALY",
    )
    assert "ANOMALOUS" in result
    assert "Timeout" in result


def test_generate_interpretation_warning():
    result = LSICollector._generate_interpretation(
        complexity=0.5, error_ratio=0.12, topics=[], error_patterns=[],
        dominant_themes=[], log_diversity="MODERATE", status="WARNING",
    )
    assert "WARNING" in result


def test_generate_interpretation_includes_error_rate():
    result = LSICollector._generate_interpretation(
        complexity=0.2, error_ratio=0.35, topics=[], error_patterns=[],
        dominant_themes=[], log_diversity="LOW", status="ANOMALY",
    )
    assert "CRITICAL" in result or "35.0%" in result


# --- _compute_semantics via _close_window ---


def test_close_window_populates_topics_after_fit():
    """_compute_semantics is called on window close and populates topics."""
    collector = make_fitted_collector()
    collector.window_counts = {"INFO": 8, "WARN": 1, "ERROR": 1, "NOVEL": 0}
    collector.window_total = 10
    collector._close_window()
    assert isinstance(collector.topics, list)
    assert len(collector.topics) > 0
    first = collector.topics[0]
    assert "topic_id" in first and "label" in first and "top_terms" in first


def test_close_window_sets_log_diversity():
    """After a window close on a fitted collector, log_diversity is categorized."""
    collector = make_fitted_collector()
    collector.window_counts = {"INFO": 10, "WARN": 0, "ERROR": 0, "NOVEL": 0}
    collector.window_total = 10
    collector._close_window()
    assert collector.log_diversity in ("LOW", "MODERATE", "HIGH", "INSUFFICIENT")


def test_close_window_sets_interpretation():
    """After a window close with errors, interpretation is a non-empty string."""
    collector = make_fitted_collector()
    collector.window_counts = {"INFO": 0, "WARN": 0, "ERROR": 10, "NOVEL": 0}
    collector.window_total = 10
    collector._close_window()
    assert isinstance(collector.interpretation, str)
    assert len(collector.interpretation) > 0


def test_compute_semantics_no_op_before_fit():
    """_compute_semantics is a no-op when the model is not fitted."""
    collector = LSICollector(service_name="test")
    collector._compute_semantics(error_count=5, warning_count=2, window_total=10)
    assert collector.topics == []
    assert collector.interpretation == ""
