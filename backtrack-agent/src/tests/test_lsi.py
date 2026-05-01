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
    assert result["corpus_size"] == CORPUS_SIZE
    for key in (
        "current_score",
        "baseline_mean",
        "threshold",
        "is_anomalous",
        "window_counts",
        "score_history",
        "recent_lines",
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
    pre_corpus = (
        ["error exception failed crash"] * 50
        + ["warning deprecated slow"] * 50
        + ["started ready connected"] * 50
        + ["random noise line " + str(i) for i in range(49)]
    )
    for line in pre_corpus:
        await collector._process_line(line)
    assert not collector.fitted
    await collector._process_line("final line triggers fit")
    assert collector.fitted


async def test_process_line_after_fit_adds_to_recent_lines():
    collector = make_fitted_collector()
    await collector._process_line("error something crashed")
    assert len(collector.recent_lines) == 1
    entry = collector.recent_lines[0]
    assert "line" in entry and "label" in entry and "timestamp" in entry
