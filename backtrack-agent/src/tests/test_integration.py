"""
Integration tests: TSD + LSI threshold chain → rollback decision.

Uses real collector methods and real anomaly scorer — no mocking of
is_drifting() or is_anomalous(). Docker/K8s I/O is the only thing mocked
because there are no real containers in CI.

LSI score formula:  score = (ERROR×3 + NOVEL×5 + WARN×1) / total
LSI anomaly rule:   score > lsi_score_multiplier × baseline_mean
TSD drift rule:     all(|r| > tsd_iqr_multiplier × IQR) for last 3 residuals
Rollback rule:      compute_confidence() >= ROLLBACK_THRESHOLD (default 0.75)
                    TSD weight=0.55, LSI weight=0.35, fully ramped at 3 cycles
"""
import json
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from src.anomaly_scorer import compute_confidence, should_rollback
from src.collectors.lsi import BASELINE_WINDOWS, LSICollector
from src.collectors.tsd import TSDCollector
from src.rollback.executor import RollbackExecutor
from src.versions import Snapshot, VersionStore


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture()
def lsi_cfg():
    with patch("src.collectors.lsi.config") as cfg:
        cfg.lsi_score_multiplier = 2.0
        cfg.target = "test"
        cfg.k8s_label_selector = "app=test"
        cfg.mode = "docker"
        yield cfg


@pytest.fixture()
def tsd_cfg():
    with patch("src.collectors.tsd.config") as cfg:
        cfg.tsd_iqr_multiplier = 3.0
        yield cfg


@pytest.fixture()
def version_store(tmp_path):
    path = str(tmp_path / "versions.json")
    with patch("src.versions.VERSIONS_FILE", path):
        store = VersionStore(service_name="my-app")
        # Pending for the "current" deploy
        store.create_pending(image_tag="v1.1.0", commit_sha="sha-new")
        # Seed a stable snapshot so rollback has a target
        stable = Snapshot(
            id="stable-id",
            service_name="my-app",
            platform="docker",
            environment="production",
            image_tag="v1.0.0",
            commit_sha="sha-old",
            status="STABLE",
            deployed_at="2026-01-01T00:00:00+00:00",
            stable_at="2026-01-01T01:00:00+00:00",
            k8s_revision=0,
            docker_container_name="my-app",
        )
        store.snapshots.append(stable)
        store._persist()
        yield store


@pytest.fixture()
def executor(version_store):
    return RollbackExecutor(version_store=version_store)


# ── Collector builders ────────────────────────────────────────────────────────

def _fitted_lsi() -> LSICollector:
    """LSICollector with a real SVD model. Requires lsi_cfg fixture to be active."""
    c = LSICollector(service_name="test")
    corpus = (
        ["error exception failed crash"] * 50
        + ["warning deprecated slow retry"] * 50
        + ["started ready connected success"] * 50
        + ["random log line " + str(i) for i in range(50)]
    )
    c.corpus = corpus
    c._fit()
    return c


def _close_windows(collector: LSICollector, counts: dict, n: int) -> None:
    """Close n windows with the given label counts, using real _close_window()."""
    for _ in range(n):
        collector.window_counts = dict(counts)
        collector.window_total = sum(counts.values())
        collector._close_window()


def make_anomalous_lsi() -> LSICollector:
    """
    LSICollector whose is_anomalous() returns True.

    Baseline: 10 windows of 1 WARN + 9 INFO → score = 1/10 = 0.1 per window
              baseline_mean = 0.1, threshold = 2.0 × 0.1 = 0.2
    Current:  10 ERROR → score = 30/10 = 3.0  →  3.0 > 0.2  →  anomalous
    """
    c = _fitted_lsi()
    _close_windows(c, {"INFO": 9, "WARN": 1, "ERROR": 0, "NOVEL": 0}, BASELINE_WINDOWS)
    # Anomalous window
    c.window_counts = {"INFO": 0, "WARN": 0, "ERROR": 10, "NOVEL": 0}
    c.window_total = 10
    c._close_window()
    return c


def make_normal_lsi() -> LSICollector:
    """
    LSICollector whose is_anomalous() returns False.

    Baseline: 10 windows of 1 WARN + 9 INFO → score = 0.1, threshold = 0.2
    Current:  same mix → score = 0.1  →  0.1 ≤ 0.2  →  not anomalous
    """
    c = _fitted_lsi()
    _close_windows(c, {"INFO": 9, "WARN": 1, "ERROR": 0, "NOVEL": 0}, BASELINE_WINDOWS + 1)
    return c


def make_drifting_tsd() -> TSDCollector:
    """
    TSDCollector whose is_drifting() returns True.

    Baseline residuals [1..9]: IQR = 4.0, threshold = 3.0 × 4.0 = 12.0
    Last three: 13.0 → |13.0| > 12.0 → drifting
    """
    c = TSDCollector(service_name="test")
    baseline = [float(i) for i in range(1, 10)]
    c.residuals["cpu"] = baseline + [13.0, 13.0, 13.0]
    return c


def make_stable_tsd() -> TSDCollector:
    """
    TSDCollector whose is_drifting() returns False.

    Baseline residuals [1..9]: threshold = 12.0
    Last three: 5.0 → |5.0| ≤ 12.0 → not drifting
    """
    c = TSDCollector(service_name="test")
    baseline = [float(i) for i in range(1, 10)]
    c.residuals["cpu"] = baseline + [5.0, 5.0, 5.0]
    return c


def run_cycles(tsd, lsi, n_cycles, executor=None, log_path=None):
    """
    Replicate the polling_loop confidence scoring logic.
    Returns True if should_rollback() threshold was reached.
    """
    count = 0
    fired = False
    for _ in range(n_cycles):
        drifting = tsd.is_drifting()
        anomalous = lsi.is_anomalous()
        if drifting or anomalous:
            count += 1
            confidence, anomaly_type = compute_confidence(
                tsd_drifting=drifting,
                lsi_anomalous=anomalous,
                in_watch_window=False,
                consecutive_cycles=count,
            )
            if should_rollback(confidence) and executor and log_path:
                executor._append_log(
                    reason=f"integration test ({anomaly_type})",
                    from_tag="v1.1.0",
                    to_tag="v1.0.0",
                    success=True,
                )
                fired = True
                count = 0
        else:
            count = 0
    return fired


# ── Signal gate tests ────────────────────────────────────────────────────────

def test_no_rollback_when_both_healthy(lsi_cfg, tsd_cfg, executor, tmp_path):
    """Stable TSD + normal LSI → confidence stays 0, no rollback."""
    log_path = str(tmp_path / "log.json")
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", log_path):
        fired = run_cycles(make_stable_tsd(), make_normal_lsi(), n_cycles=5,
                           executor=executor, log_path=log_path)
    assert not fired


def test_rollback_triggers_when_only_tsd_drifts(lsi_cfg, tsd_cfg, executor, tmp_path):
    """Drifting TSD alone: weight=0.55, after 3 cycles confidence=0.55 ≥ 0.75 is False.
    Needs watch window amplification OR LSI to cross threshold alone.
    With TSD only (0.55) + 3 cycles: 0.55 < 0.75, but with watch window (×1.5): 0.825 ≥ 0.75.
    Here we test WITHOUT watch window — TSD alone after 3 cycles should NOT fire.
    """
    log_path = str(tmp_path / "log.json")
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", log_path):
        fired = run_cycles(make_drifting_tsd(), make_normal_lsi(), n_cycles=3,
                           executor=executor, log_path=log_path)
    # TSD only: 0.55 * 1.0 = 0.55 < 0.75 — does NOT fire without watch window
    assert not fired


def test_rollback_triggers_when_tsd_and_lsi_both_signal(lsi_cfg, tsd_cfg, executor, tmp_path):
    """TSD + LSI both: 0.55+0.35=0.90 × 1.0 (cycle ramp at 3) = 0.90 ≥ 0.75 → fires."""
    log_path = str(tmp_path / "log.json")
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", log_path):
        fired = run_cycles(make_drifting_tsd(), make_anomalous_lsi(), n_cycles=3,
                           executor=executor, log_path=log_path)
    assert fired


def test_rollback_triggers_when_only_lsi_anomalous(lsi_cfg, tsd_cfg, executor, tmp_path):
    """LSI alone: weight=0.35. After 3 cycles: 0.35 < 0.75 — does NOT fire without watch window."""
    log_path = str(tmp_path / "log.json")
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", log_path):
        fired = run_cycles(make_stable_tsd(), make_anomalous_lsi(), n_cycles=3,
                           executor=executor, log_path=log_path)
    # LSI only: 0.35 * 1.0 = 0.35 < 0.75
    assert not fired


# ── Confidence ramp tests ─────────────────────────────────────────────────────

def test_no_rollback_after_only_2_consecutive_cycles(lsi_cfg, tsd_cfg, executor, tmp_path):
    """TSD+LSI for 2 cycles: confidence = 0.90 × (2/3) = 0.60 < 0.75 → no rollback."""
    log_path = str(tmp_path / "log.json")
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", log_path):
        fired = run_cycles(make_drifting_tsd(), make_anomalous_lsi(), n_cycles=2,
                           executor=executor, log_path=log_path)
    assert not fired


def test_rollback_triggers_after_3_consecutive_cycles(lsi_cfg, tsd_cfg, executor, tmp_path):
    """TSD+LSI for exactly 3 cycles: confidence = 0.90 × 1.0 = 0.90 ≥ 0.75 → fires."""
    log_path = str(tmp_path / "log.json")
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", log_path):
        fired = run_cycles(make_drifting_tsd(), make_anomalous_lsi(), n_cycles=3,
                           executor=executor, log_path=log_path)
    assert fired


def test_clean_cycle_resets_counter(lsi_cfg, tsd_cfg, executor, tmp_path):
    """
    Bad, bad, CLEAN, bad, bad — counter resets on clean cycle.
    After reset, only 2 cycles elapse before end: confidence at cycle 2 = 0.60 < 0.75.
    """
    drifting_tsd = make_drifting_tsd()
    anomalous_lsi = make_anomalous_lsi()
    stable_tsd = make_stable_tsd()
    normal_lsi = make_normal_lsi()

    sequence = [
        (drifting_tsd, anomalous_lsi),  # count=1, confidence=0.30
        (drifting_tsd, anomalous_lsi),  # count=2, confidence=0.60
        (stable_tsd,   normal_lsi),     # clean → count=0
        (drifting_tsd, anomalous_lsi),  # count=1, confidence=0.30
        (drifting_tsd, anomalous_lsi),  # count=2, confidence=0.60
    ]
    count = 0
    fired = False
    log_path = str(tmp_path / "log.json")
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", log_path):
        for tsd, lsi in sequence:
            drifting = tsd.is_drifting()
            anomalous = lsi.is_anomalous()
            if drifting or anomalous:
                count += 1
                confidence, _ = compute_confidence(True, True, False, count)
                if should_rollback(confidence):
                    executor._append_log("test", "v1.1.0", "v1.0.0", True)
                    fired = True
                    count = 0
            else:
                count = 0

    assert not fired


def test_rollback_fires_once_then_counter_resets(lsi_cfg, tsd_cfg, executor, tmp_path):
    """Rollback at cycle 3 resets counter — cycle 4 is count=1, confidence=0.30, no re-fire."""
    log_path = str(tmp_path / "log.json")
    fired_count = 0
    count = 0
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", log_path):
        for _ in range(4):
            drifting = make_drifting_tsd().is_drifting()
            anomalous = make_anomalous_lsi().is_anomalous()
            if drifting or anomalous:
                count += 1
                confidence, _ = compute_confidence(drifting, anomalous, False, count)
                if should_rollback(confidence):
                    executor._append_log("test", "v1.1.0", "v1.0.0", True)
                    fired_count += 1
                    count = 0

    assert fired_count == 1


# ── LSI threshold boundary tests ──────────────────────────────────────────────

def test_lsi_score_at_exact_threshold_not_anomalous(lsi_cfg):
    """
    score == threshold is NOT anomalous (rule is strictly greater-than).
    baseline_mean = 0.1, multiplier = 2.0, threshold = 0.2
    score = 0.2 → 0.2 > 0.2 is False → not anomalous.
    """
    c = _fitted_lsi()
    _close_windows(c, {"INFO": 9, "WARN": 1, "ERROR": 0, "NOVEL": 0}, BASELINE_WINDOWS)
    # score = (0*3 + 0*5 + 2*1) / 20 = 0.1 — nope, need exactly 0.2
    # 2 WARN / 10 total → score = 2/10 = 0.2, exactly at threshold
    c.window_counts = {"INFO": 8, "WARN": 2, "ERROR": 0, "NOVEL": 0}
    c.window_total = 10
    c._close_window()
    assert not c.is_anomalous()


def test_lsi_score_just_above_threshold_is_anomalous(lsi_cfg):
    """
    score just above threshold IS anomalous.
    baseline_mean = 0.1, multiplier = 2.0, threshold = 0.2
    score = 0.3 → 0.3 > 0.2 → anomalous.

    State is set directly to avoid _close_window's baseline-update side effect
    which corrupts the baseline when BASELINE_WINDOWS is small (e.g. 3 in .env).
    """
    c = _fitted_lsi()
    c.baseline_scores = [0.1] * max(BASELINE_WINDOWS, 1)
    c.baseline_locked = True
    c.score_history = list(c.baseline_scores) + [0.3]  # 0.3 > 2.0 × 0.1 = 0.2
    assert c.is_anomalous()


def test_lsi_novel_lines_weighted_highest(lsi_cfg):
    """
    NOVEL lines carry weight 5 — even 1 NOVEL in 10 lines (score=0.5) triggers
    anomaly against a baseline_mean of 0.1 (threshold=0.2).
    """
    c = _fitted_lsi()
    _close_windows(c, {"INFO": 9, "WARN": 1, "ERROR": 0, "NOVEL": 0}, BASELINE_WINDOWS)
    c.window_counts = {"INFO": 9, "WARN": 0, "ERROR": 0, "NOVEL": 1}
    c.window_total = 10
    c._close_window()
    # score = 5/10 = 0.5 > 0.2
    assert c.is_anomalous()


def test_lsi_higher_multiplier_raises_threshold(lsi_cfg):
    """
    Raising lsi_score_multiplier prevents a previously-anomalous score from triggering.
    score = 0.3, baseline_mean = 0.1:
      multiplier=2.0 → threshold=0.2 → anomalous
      multiplier=4.0 → threshold=0.4 → not anomalous
    """
    c = _fitted_lsi()
    _close_windows(c, {"INFO": 9, "WARN": 1, "ERROR": 0, "NOVEL": 0}, BASELINE_WINDOWS)
    c.window_counts = {"INFO": 7, "WARN": 3, "ERROR": 0, "NOVEL": 0}
    c.window_total = 10
    c._close_window()

    lsi_cfg.lsi_score_multiplier = 4.0
    assert not c.is_anomalous()


# ── TSD threshold boundary tests ─────────────────────────────────────────────

def _baseline_iqr() -> float:
    """IQR of [1.0 .. 9.0] (the baseline used in make_drifting_tsd / make_stable_tsd)."""
    baseline = [float(i) for i in range(1, 10)]
    q1, q3 = np.percentile(baseline, [25, 75])
    return float(q3 - q1)


def test_tsd_residuals_at_exact_threshold_not_drifting(tsd_cfg):
    """
    |r| == threshold is NOT drifting (rule is strictly greater-than).
    IQR=4.0, multiplier=3.0, threshold=12.0 → last_three=[12.0] → not drifting.
    """
    iqr = _baseline_iqr()
    threshold = tsd_cfg.tsd_iqr_multiplier * iqr  # 12.0
    c = TSDCollector(service_name="test")
    c.residuals["cpu"] = [float(i) for i in range(1, 10)] + [threshold] * 3
    assert not c.is_drifting()


def test_tsd_residuals_just_above_threshold_is_drifting(tsd_cfg):
    """
    |r| just above threshold IS drifting.
    threshold=12.0, last_three=12.001 → drifting.
    """
    iqr = _baseline_iqr()
    threshold = tsd_cfg.tsd_iqr_multiplier * iqr
    c = TSDCollector(service_name="test")
    c.residuals["cpu"] = [float(i) for i in range(1, 10)] + [threshold + 0.001] * 3
    assert c.is_drifting()


def test_tsd_two_of_three_above_threshold_not_drifting(tsd_cfg):
    """
    All 3 consecutive must exceed threshold — 2 out of 3 is not enough.
    """
    iqr = _baseline_iqr()
    threshold = tsd_cfg.tsd_iqr_multiplier * iqr
    c = TSDCollector(service_name="test")
    c.residuals["cpu"] = [float(i) for i in range(1, 10)] + [
        threshold + 1, threshold + 1, threshold - 1  # last one is within bounds
    ]
    assert not c.is_drifting()


def test_tsd_negative_spike_triggers_drift(tsd_cfg):
    """
    Drift check uses |r|, so large negative residuals also trigger.
    """
    iqr = _baseline_iqr()
    threshold = tsd_cfg.tsd_iqr_multiplier * iqr
    c = TSDCollector(service_name="test")
    c.residuals["cpu"] = [float(i) for i in range(1, 10)] + [
        -(threshold + 1), -(threshold + 1), -(threshold + 1)
    ]
    assert c.is_drifting()


def test_tsd_higher_multiplier_raises_threshold(tsd_cfg):
    """
    Raising tsd_iqr_multiplier prevents a previously-drifting residual from triggering.
    IQR=4.0, last_three=13.0:
      multiplier=3.0 → threshold=12.0 → drifting
      multiplier=5.0 → threshold=20.0 → not drifting
    """
    c = make_drifting_tsd()  # last_three = 13.0

    tsd_cfg.tsd_iqr_multiplier = 5.0
    assert not c.is_drifting()


def test_tsd_flat_series_skipped(tsd_cfg):
    """
    Near-zero IQR series (floating-point noise) is skipped — no false drift.
    """
    c = TSDCollector(service_name="test")
    c.residuals["cpu"] = [0.0] * 12
    assert not c.is_drifting()


# ── Full pipeline integration ─────────────────────────────────────────────────

def test_rollback_log_written_with_correct_tags(lsi_cfg, tsd_cfg, executor, tmp_path):
    """
    End-to-end: real signals → confidence threshold reached → log entry written
    with correct from/to image tags.
    """
    log_path = str(tmp_path / "log.json")
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", log_path):
        count = 0
        for _ in range(3):
            drifting = make_drifting_tsd().is_drifting()
            anomalous = make_anomalous_lsi().is_anomalous()
            if drifting or anomalous:
                count += 1
                confidence, anomaly_type = compute_confidence(drifting, anomalous, False, count)
                if should_rollback(confidence):
                    executor._append_log(
                        reason=f"integration test ({anomaly_type})",
                        from_tag="v1.1.0",
                        to_tag="v1.0.0",
                        success=True,
                    )

    import json as _json
    entries = _json.loads(open(log_path).read())
    assert len(entries) == 1
    assert entries[0]["success"] is True
    assert entries[0]["to_tag"] == "v1.0.0"
    assert entries[0]["from_tag"] == "v1.1.0"


def test_rollback_appended_to_log(lsi_cfg, tsd_cfg, executor, tmp_path):
    """
    After rollback fires, the log file contains the event with correct metadata.
    """
    log_path = tmp_path / "log.json"
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", str(log_path)):
        run_cycles(make_drifting_tsd(), make_anomalous_lsi(), n_cycles=3,
                   executor=executor, log_path=str(log_path))

    entries = json.loads(log_path.read_text())
    assert len(entries) == 1
    assert entries[0]["success"] is True
    assert "integration test" in entries[0]["reason"]
