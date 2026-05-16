#!/usr/bin/env bash
# ============================================================
# BackTrack Test Results Analyzer
# Captures logs + classifications + accuracy metrics per app
# Usage: ./analyze_results.sh [fault_label]
# Example: ./analyze_results.sh "cpu-spike"
# ============================================================

AGENT_URL="http://localhost:8847"
LABEL="${1:-test}"
OUTPUT="analysis_${LABEL// /_}_$(date +%Y%m%d_%H%M%S).json"

FAULT_APPS=(app-fault-1 app-fault-2 app-fault-3 app-fault-4 app-fault-5)
ALL_APPS=(app-fault-1 app-fault-2 app-fault-3 app-fault-4 app-fault-5 app-nginx app-grafana app-prometheus app-rabbitmq app-redis)

echo ""
echo "======================================================"
echo "  BACKTRACK RESULTS ANALYZER"
echo "  Label: $LABEL"
echo "  Time:  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "======================================================"

python3 - <<PYEOF
import json, urllib.request, subprocess, datetime, sys

AGENT_URL = "$AGENT_URL"
LABEL     = "$LABEL"
OUTPUT    = "$OUTPUT"
ALL_APPS  = [
    "app-fault-1","app-fault-2","app-fault-3","app-fault-4","app-fault-5",
    "app-nginx","app-grafana","app-prometheus","app-rabbitmq","app-redis"
]
FAULT_APPS = ["app-fault-1","app-fault-2","app-fault-3","app-fault-4","app-fault-5"]

def fetch(path):
    try:
        with urllib.request.urlopen(f"{AGENT_URL}{path}", timeout=5) as r:
            return json.load(r)
    except Exception as e:
        return {"error": str(e)}

def docker_logs(container, lines=30):
    try:
        result = subprocess.run(
            ["docker", "logs", "--tail", str(lines), container],
            capture_output=True, text=True
        )
        raw = (result.stdout + result.stderr).strip().splitlines()
        return [l.strip() for l in raw if l.strip()]
    except Exception as e:
        return [f"ERROR fetching logs: {e}"]

# ── Collect data from all apps ──────────────────────────────
report = {
    "label":        LABEL,
    "collected_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "apps":         {}
}

for app in ALL_APPS:
    print(f"  Collecting {app}...", flush=True)
    tsd = fetch(f"/metrics?service={app}")
    lsi = fetch(f"/lsi?service={app}")

    # Docker logs + LSI per-line classifications
    logs = docker_logs(app, lines=50)
    classified_lines = lsi.get("recent_lines", [])

    # LSI evaluation block
    lsi_eval = lsi.get("evaluation", {})
    per_class = lsi_eval.get("per_class", {})

    # TSD evaluation block
    tsd_eval = tsd.get("evaluation", {})
    cm       = tsd_eval.get("confusion_matrix", {})

    report["apps"][app] = {
        # ── Detection signals ──────────────────────────────
        "detection": {
            "tsd_drifting":       tsd.get("is_drifting"),
            "lsi_error_anomalous":lsi.get("is_error_anomalous"),
            "has_crashed":        tsd.get("has_crashed"),
            "readings_count":     tsd.get("readings_count"),
            "tsd_confidence":     tsd.get("tsd_confidence"),
        },
        # ── Current metrics ────────────────────────────────
        "metrics": tsd.get("current", {}),
        # ── TSD algorithm state ────────────────────────────
        "tsd": {
            "status":           tsd.get("tsd_status", {}),
            "z_scores":         tsd.get("z_scores", {}),
            "trend_directions": tsd.get("trend_directions", {}),
            "cpu_history":      tsd.get("history", {}).get("cpu", [])[-10:],
            "memory_history":   tsd.get("history", {}).get("memory", [])[-10:],
        },
        # ── TSD accuracy metrics ───────────────────────────
        "tsd_accuracy": {
            "drift_events_total":  tsd_eval.get("drift_events_total", 0),
            "TP_sustained":        cm.get("TP_sustained", 0),
            "FP_spikes":           cm.get("FP_spikes", 0),
            "TN_clean_cycles":     cm.get("TN_clean_cycles", 0),
            "FN_note":             cm.get("note", ""),
            "estimated_precision": tsd_eval.get("estimated_precision", 0.0),
            "per_metric_drifts":   tsd_eval.get("per_metric_drifts", {}),
        },
        # ── LSI algorithm state ────────────────────────────
        "lsi": {
            "fitted":              lsi.get("fitted"),
            "corpus_size":         lsi.get("corpus_size"),
            "current_score":       lsi.get("current_score"),
            "baseline_mean":       lsi.get("baseline_mean"),
            "threshold":           lsi.get("threshold"),
            "error_score":         lsi.get("error_score"),
            "error_threshold":     lsi.get("error_threshold"),
            "log_diversity":       lsi.get("log_diversity"),
            "dominant_themes":     lsi.get("dominant_themes", []),
            "error_patterns":      lsi.get("error_patterns", []),
            "score_history":       lsi.get("score_history", [])[-10:],
            "window_counts":       lsi.get("window_counts", {}),
        },
        # ── LSI per-class accuracy metrics ─────────────────
        "lsi_accuracy": {
            cls: {
                "precision": per_class.get(cls, {}).get("precision", 0.0),
                "recall":    per_class.get(cls, {}).get("recall",    0.0),
                "f1":        per_class.get(cls, {}).get("f1",        0.0),
                "TP": per_class.get(cls, {}).get("tp", 0),
                "FP": per_class.get(cls, {}).get("fp", 0),
                "FN": per_class.get(cls, {}).get("fn", 0),
                "TN": per_class.get(cls, {}).get("tn", 0),
            }
            for cls in ["INFO", "WARN", "ERROR", "NOVEL"]
        },
        "lsi_confusion_matrix":   lsi_eval.get("confusion_matrix", {}),
        "svd_classified_total":   lsi_eval.get("svd_classified_total", 0),
        # ── Log lines + classifications ────────────────────
        "log_sample": {
            "docker_logs_last50": logs,
            "lsi_classified_lines": [
                {"line": e.get("line",""), "label": e.get("label","?")}
                for e in classified_lines
            ],
            "window_label_counts": lsi.get("window_counts", {}),
        },
    }

# Save JSON
with open(OUTPUT, "w") as f:
    json.dump(report, f, indent=2)

# ── Print human-readable report ─────────────────────────────
SEP = "=" * 70

print(f"\n{SEP}")
print(f"  LABEL: {LABEL}")
print(SEP)

for app, d in report["apps"].items():
    det   = d["detection"]
    tacc  = d["tsd_accuracy"]
    lacc  = d["lsi_accuracy"]
    lsi_d = d["lsi"]
    logs  = d["log_sample"]

    drifting  = det["tsd_drifting"]
    anomalous = det["lsi_error_anomalous"]
    crashed   = det["has_crashed"]
    detected  = drifting or anomalous or crashed

    status = "DETECTED ✓" if detected else "not detected"

    print(f"\n  {'─'*66}")
    print(f"  APP: {app:<20}  Status: {status}")
    print(f"  {'─'*66}")
    print(f"  Readings: {det['readings_count']}   Confidence: {det['tsd_confidence']:.3f}")
    print(f"  TSD drifting: {str(drifting):<6}  LSI error_anomalous: {str(anomalous):<6}  Crashed: {crashed}")

    print(f"\n  ── TSD Accuracy ──")
    print(f"  TP (sustained drifts): {tacc['TP_sustained']}")
    print(f"  FP (spike drifts):     {tacc['FP_spikes']}")
    print(f"  TN (clean cycles):     {tacc['TN_clean_cycles']}")
    print(f"  Estimated Precision:   {tacc['estimated_precision']:.4f}")
    print(f"  Per-metric drifts:     {tacc['per_metric_drifts']}")

    print(f"\n  ── LSI Accuracy (keyword reference vs SVD prediction) ──")
    print(f"  {'Class':<8} {'Precision':>10} {'Recall':>8} {'F1':>8} {'TP':>5} {'FP':>5} {'FN':>5} {'TN':>5}")
    print(f"  {'-'*58}")
    for cls in ["INFO", "WARN", "ERROR", "NOVEL"]:
        m = lacc[cls]
        print(f"  {cls:<8} {m['precision']:>10.4f} {m['recall']:>8.4f} {m['f1']:>8.4f} {m['TP']:>5} {m['FP']:>5} {m['FN']:>5} {m['TN']:>5}")

    print(f"\n  SVD classified total: {d['svd_classified_total']}")
    print(f"  LSI score: {lsi_d['current_score']:.4f}  baseline: {lsi_d['baseline_mean']:.4f}  threshold: {lsi_d['threshold']:.4f}")
    print(f"  Log diversity: {lsi_d['log_diversity']}  Dominant themes: {lsi_d['dominant_themes']}")
    if lsi_d['error_patterns']:
        print(f"  Error patterns: {lsi_d['error_patterns']}")

    print(f"\n  ── Recent Log Lines + LSI Classification ──")
    classified = logs["lsi_classified_lines"]
    if classified:
        for entry in classified[-10:]:
            label = entry["label"]
            line  = entry["line"][:80]
            marker = "🔴" if label == "ERROR" else "🟡" if label == "WARN" else "🟢" if label == "INFO" else "🔵"
            print(f"  {marker} [{label:5}] {line}")
    else:
        print("  (no classified lines yet)")

print(f"\n{SEP}")
print(f"  Full JSON saved to: {OUTPUT}")
print(SEP)
PYEOF
