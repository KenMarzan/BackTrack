"""
Anomaly confidence scorer.

Replaces the raw 3-cycle counter with a weighted confidence score.
Confidence is in [0.0, 1.0]. Rollback triggers when confidence >= threshold.

Signal weights:
  TSD  0.55  — metric drift; slower to react but reliable
  LSI  0.35  — log spikes; can be noisy right after deploys
  CRASH 1.0  — immediate; bypasses confidence system entirely

Watch window multiplier: during the 5-min post-deploy window, sensitivity
is raised (scores are amplified) so regressions introduced by the new
deploy are caught faster than background noise on a stable service.
"""
from __future__ import annotations

import os

TSD_WEIGHT = float(os.getenv("BACKTRACK_WEIGHT_TSD", "0.55"))
LSI_WEIGHT = float(os.getenv("BACKTRACK_WEIGHT_LSI", "0.35"))
WATCH_MULTIPLIER = float(os.getenv("BACKTRACK_WATCH_MULTIPLIER", "1.5"))
ROLLBACK_THRESHOLD = float(os.getenv("BACKTRACK_ROLLBACK_THRESHOLD", "0.75"))


def compute_confidence(
    tsd_drifting: bool,
    lsi_anomalous: bool,
    in_watch_window: bool,
    consecutive_cycles: int,
) -> tuple[float, str]:
    """
    Returns (confidence_score, anomaly_type_label).

    consecutive_cycles: how many back-to-back scrape cycles had at least one anomaly signal.
    Confidence scales linearly from 0 at cycle 1 to full weight at cycle 3.
    Watch window amplifies the score — deploys that immediately regress
    hit the threshold in ~2 cycles instead of 3.
    """
    score = 0.0
    signals: list[str] = []

    if tsd_drifting:
        score += TSD_WEIGHT
        signals.append("TSD")
    if lsi_anomalous:
        score += LSI_WEIGHT
        signals.append("LSI")

    if score == 0.0:
        return 0.0, "NONE"

    # Ramp confidence over consecutive cycles — 3 cycles = full weight.
    # This prevents single-spike false positives.
    cycle_ramp = min(consecutive_cycles / 3.0, 1.0)
    score *= cycle_ramp

    if in_watch_window:
        score *= WATCH_MULTIPLIER

    score = min(score, 1.0)
    return score, "+".join(signals)


def should_rollback(confidence: float) -> bool:
    return confidence >= ROLLBACK_THRESHOLD
