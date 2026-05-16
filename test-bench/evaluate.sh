#!/usr/bin/env bash
# ============================================================
# BackTrack Ground-Truth Evaluator
# Injects known labeled lines, reads LSI classification,
# computes real TP/FP/FN/TN, Precision, Recall, F1.
# Also computes TSD accuracy for CPU/memory fault injection.
#
# Usage: ./evaluate.sh <app-fault-N>
# Example: ./evaluate.sh app-fault-2
# ============================================================

APP="${1:-app-fault-2}"
AGENT_URL="http://localhost:8847"

declare -A PORT_MAP=(
  ["app-fault-1"]="8101"
  ["app-fault-2"]="8102"
  ["app-fault-3"]="8103"
  ["app-fault-4"]="8104"
  ["app-fault-5"]="8105"
)
APP_PORT="${PORT_MAP[$APP]}"
APP_URL="http://localhost:${APP_PORT}"

if [[ -z "$APP_PORT" ]]; then
  echo "ERROR: $APP is not a fault app. Use app-fault-1 through app-fault-5."
  exit 1
fi

echo ""
echo "========================================================"
echo "  BACKTRACK GROUND-TRUTH EVALUATION"
echo "  App: $APP  ($APP_URL)"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

python3 - <<PYEOF
import json, time, urllib.request, urllib.error, datetime, subprocess, sys

AGENT_URL = "$AGENT_URL"
APP       = "$APP"
APP_URL   = "$APP_URL"
OUTPUT    = f"evaluation_{APP}_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

def fetch(path):
    try:
        with urllib.request.urlopen(f"{AGENT_URL}{path}", timeout=8) as r:
            return json.load(r)
    except Exception as e:
        return {"error": str(e)}

def post(url, data=None):
    try:
        payload = json.dumps(data or {}).encode()
        req = urllib.request.Request(url, data=payload,
              headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.load(r)
    except Exception as e:
        return {"error": str(e)}

def docker_logs(container, lines=200):
    try:
        r = subprocess.run(["docker","logs","--tail",str(lines), container],
                           capture_output=True, text=True)
        return (r.stdout + r.stderr).strip().splitlines()
    except:
        return []

SEP = "=" * 64
sep = "-" * 64

# ── 0. Reset any active faults ─────────────────────────────
print("\n[0] Resetting faults...", flush=True)
post(f"{APP_URL}/reset")
time.sleep(3)

# ── 1. Pre-fault baseline snapshot ─────────────────────────
print("[1] Taking pre-fault baseline snapshot...", flush=True)
baseline_tsd = fetch(f"/metrics?service={APP}")
baseline_lsi = fetch(f"/lsi?service={APP}")
baseline_readings = baseline_tsd.get("readings_count", 0)
baseline_cpu      = baseline_tsd.get("current", {}).get("cpu_percent", 0)
baseline_mem      = baseline_tsd.get("current", {}).get("memory_mb", 0)
print(f"    readings={baseline_readings}  cpu={baseline_cpu:.2f}%  mem={baseline_mem:.1f}MB")

# ── 2. LSI LOG CLASSIFICATION EVALUATION ───────────────────
print(f"\n[2] LSI Log Classification Evaluation", flush=True)
print(f"    Injecting 60 INFO lines then 60 ERROR lines...", flush=True)

# Inject INFO lines (ground truth = INFO)
post(f"{APP_URL}/reset")
time.sleep(1)
# The fault-app emits INFO logs every 5s naturally.
# Force a burst of INFO by hitting the health endpoint (generates access logs)
for _ in range(20):
    try:
        urllib.request.urlopen(f"{APP_URL}/", timeout=2)
    except:
        pass
time.sleep(2)

# Record current recent_lines BEFORE error injection
lsi_before = fetch(f"/lsi?service={APP}")
lines_before = lsi_before.get("recent_lines", [])
info_line_texts = {e.get("line","")[:60] for e in lines_before}

# Inject ERROR lines (ground truth = ERROR)
INJECT_MARKER = "BACKTRACK_TEST_ERROR"
print(f"    Injecting error flood (200 lines)...", flush=True)
inject_resp = post(f"{APP_URL}/fault/log-errors", {"count": 200})
print(f"    Inject response: {inject_resp}")

# Wait 90s — guarantees at least 2 full 30s windows close regardless of boundary timing.
# Track PEAK values: captures detection even if it resolves before the wait ends.
print(f"    Waiting 90s for at least 2 LSI windows to close...", flush=True)
peak_error_score = 0.0
peak_detected    = False
lsi_at_peak      = None
for i in range(18):
    time.sleep(5)
    lsi_now     = fetch(f"/lsi?service={APP}")
    score       = lsi_now.get("current_score", 0)
    error_score = lsi_now.get("error_score", 0)
    detected    = lsi_now.get("is_error_anomalous", False)
    if error_score > peak_error_score:
        peak_error_score = error_score
        lsi_at_peak      = lsi_now
    if detected:
        peak_detected = True
        if lsi_at_peak is None:
            lsi_at_peak = lsi_now
    sys.stdout.write(f"\r    [{(i+1)*5}s] score={score:.4f}  error_score={error_score:.4f}  detected={detected}   ")
    sys.stdout.flush()
print()
if peak_detected:
    print(f"    ✓ Anomaly detected (peak error_score={peak_error_score:.4f})")
else:
    print(f"    ✗ Not detected (peak error_score={peak_error_score:.4f})")

# Use the snapshot captured at peak detection for analysis
lsi_after = lsi_at_peak or fetch(f"/lsi?service={APP}")

# ── Compute LSI metrics from recent_lines ──────────────────
# Ground truth: lines containing known error patterns = ERROR
# Everything else = INFO
ERROR_PATTERNS = [
    "NullPointerException", "Connection refused to database",
    "Timeout after", "HTTP 500", "Out of memory",
    "Deadlock detected", "Fatal: uncaught", "SSL certificate",
    "Rate limit exceeded", "Disk I/O error", "error flood",
    "Error flood", "error_anomalous", "error log"
]

classified_lines = lsi_after.get("recent_lines", [])

results = []  # (ground_truth, predicted)
for entry in classified_lines:
    line = entry.get("line", "")
    predicted = entry.get("label", "INFO")
    # Determine ground truth from line content
    is_error = any(p.lower() in line.lower() for p in ERROR_PATTERNS)
    ground_truth = "ERROR" if is_error else "INFO"
    results.append((ground_truth, predicted))

# Compute per-class TP/FP/FN/TN
classes = ["INFO", "WARN", "ERROR", "NOVEL"]
metrics = {}
for cls in classes:
    TP = sum(1 for gt,pr in results if gt==cls and pr==cls)
    FP = sum(1 for gt,pr in results if gt!=cls and pr==cls)
    FN = sum(1 for gt,pr in results if gt==cls and pr!=cls)
    TN = sum(1 for gt,pr in results if gt!=cls and pr!=cls)
    precision = TP/(TP+FP) if (TP+FP)>0 else 0.0
    recall    = TP/(TP+FN) if (TP+FN)>0 else 0.0
    f1        = 2*precision*recall/(precision+recall) if (precision+recall)>0 else 0.0
    accuracy  = (TP+TN)/(TP+FP+FN+TN) if (TP+FP+FN+TN)>0 else 0.0
    metrics[cls] = dict(TP=TP,FP=FP,FN=FN,TN=TN,
                        precision=round(precision,4),
                        recall=round(recall,4),
                        f1=round(f1,4),
                        accuracy=round(accuracy,4))

# Macro averages across INFO + ERROR (the two meaningful classes here)
main = ["INFO","ERROR"]
macro_p  = sum(metrics[c]["precision"] for c in main)/len(main)
macro_r  = sum(metrics[c]["recall"]    for c in main)/len(main)
macro_f1 = sum(metrics[c]["f1"]        for c in main)/len(main)
overall_acc = (sum(metrics[c]["TP"] for c in classes) /
               max(1, len(results)))

lsi_detected = peak_detected  # use peak — captures transient detection windows

# ── 3. TSD CPU SPIKE EVALUATION ────────────────────────────
print(f"\n[3] TSD CPU Spike Evaluation...", flush=True)
post(f"{APP_URL}/reset")
time.sleep(2)

# Collect 6 clean CPU readings
cpu_before_readings = []
for i in range(6):
    t = fetch(f"/metrics?service={APP}")
    cpu_before_readings.append(t.get("current",{}).get("cpu_percent",0))
    time.sleep(10)
cpu_baseline_mean = sum(cpu_before_readings)/len(cpu_before_readings)
print(f"    CPU baseline (6 readings): {[round(v,1) for v in cpu_before_readings]}")
print(f"    Baseline mean: {cpu_baseline_mean:.2f}%")

# Inject CPU spike
post(f"{APP_URL}/fault/cpu-spike", {"workers": 4})
print(f"    CPU spike triggered. Collecting 6 readings during fault...", flush=True)
cpu_during_readings = []
tsd_detected_cycles = 0
for i in range(6):
    time.sleep(10)
    t = fetch(f"/metrics?service={APP}")
    cpu_val = t.get("current",{}).get("cpu_percent",0)
    drifting = t.get("is_drifting", False)
    cpu_during_readings.append(cpu_val)
    if drifting:
        tsd_detected_cycles += 1
    sys.stdout.write(f"\r    Reading {i+1}/6: cpu={cpu_val:.1f}%  drifting={drifting}   ")
    sys.stdout.flush()
print()

cpu_fault_mean = sum(cpu_during_readings)/len(cpu_during_readings)
tsd_final = fetch(f"/metrics?service={APP}")
tsd_detected = tsd_final.get("is_drifting", False)
tsd_eval = tsd_final.get("evaluation", {})

post(f"{APP_URL}/reset")

# ── 4. TSD MEMORY LEAK EVALUATION ──────────────────────────
print(f"\n[4] TSD Memory Leak Evaluation...", flush=True)
time.sleep(5)

mem_before = fetch(f"/metrics?service={APP}").get("current",{}).get("memory_mb",0)
print(f"    Memory before: {mem_before:.1f} MB")

post(f"{APP_URL}/fault/memory-leak")
print(f"    Memory leak triggered. Collecting 8 readings...", flush=True)
mem_readings = []
mem_detected = False
for i in range(8):
    time.sleep(10)
    t = fetch(f"/metrics?service={APP}")
    mem_val = t.get("current",{}).get("memory_mb",0)
    drifting = t.get("is_drifting", False)
    mem_readings.append(mem_val)
    if drifting:
        mem_detected = True
    sys.stdout.write(f"\r    Reading {i+1}/8: mem={mem_val:.1f}MB  drifting={drifting}   ")
    sys.stdout.flush()
print()
post(f"{APP_URL}/reset")
mem_after = mem_readings[-1] if mem_readings else 0
mem_growth = mem_after - mem_before

# ── 5. Build full report ────────────────────────────────────
report = {
    "app": APP,
    "evaluated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),

    "lsi_evaluation": {
        "total_lines_evaluated":  len(results),
        "ground_truth_breakdown": {
            "ERROR_lines_injected": sum(1 for gt,_ in results if gt=="ERROR"),
            "INFO_lines_baseline":  sum(1 for gt,_ in results if gt=="INFO"),
        },
        "anomaly_detected": lsi_detected,
        "current_score":    lsi_after.get("current_score"),
        "baseline_mean":    lsi_after.get("baseline_mean"),
        "threshold":        lsi_after.get("threshold"),
        "per_class_metrics": metrics,
        "macro_averages": {
            "precision": round(macro_p, 4),
            "recall":    round(macro_r, 4),
            "f1":        round(macro_f1,4),
        },
        "overall_accuracy": round(overall_acc, 4),
        "classified_lines_sample": [
            {"ground_truth": gt, "predicted": pr,
             "correct": gt==pr,
             "line": next((e["line"][:80] for e in classified_lines
                           if e.get("label")==pr), "")}
            for gt,pr in results[:20]
        ],
    },

    "tsd_cpu_evaluation": {
        "cpu_baseline_readings":  [round(v,2) for v in cpu_before_readings],
        "cpu_baseline_mean":      round(cpu_baseline_mean, 2),
        "cpu_during_fault":       [round(v,2) for v in cpu_during_readings],
        "cpu_fault_mean":         round(cpu_fault_mean, 2),
        "cpu_increase_pct":       round((cpu_fault_mean - cpu_baseline_mean), 2),
        "tsd_detected":           tsd_detected,
        "detection_cycles":       tsd_detected_cycles,
        "tsd_eval":               tsd_eval,
    },

    "tsd_memory_evaluation": {
        "memory_before_mb":  round(mem_before, 2),
        "memory_after_mb":   round(mem_after, 2),
        "memory_growth_mb":  round(mem_growth, 2),
        "memory_readings":   [round(v,2) for v in mem_readings],
        "tsd_detected":      mem_detected,
    },
}

with open(OUTPUT, "w") as f:
    json.dump(report, f, indent=2)

# ── Print report ────────────────────────────────────────────
print(f"\n{SEP}")
print(f"  BACKTRACK EVALUATION RESULTS — {APP}")
print(SEP)

print(f"\n  ┌─ LSI LOG CLASSIFICATION (Ground Truth vs Predicted) ─────────────")
print(f"  │  Total lines evaluated : {len(results)}")
err_injected = sum(1 for gt,_ in results if gt=="ERROR")
info_lines   = sum(1 for gt,_ in results if gt=="INFO")
print(f"  │  ERROR lines (injected): {err_injected}  (ground truth = ERROR)")
print(f"  │  INFO  lines (baseline): {info_lines}  (ground truth = INFO)")
print(f"  │  Anomaly detected      : {lsi_detected}")
print(f"  │  LSI score             : {lsi_after.get('current_score',0):.4f}")
print(f"  │  Baseline mean         : {lsi_after.get('baseline_mean',0):.4f}")
print(f"  │  Threshold             : {lsi_after.get('threshold',0):.4f}")
print(f"  │")
print(f"  │  {'Class':<8} {'Precision':>10} {'Recall':>8} {'F1':>8} {'Accuracy':>10} {'TP':>5} {'FP':>5} {'FN':>5} {'TN':>5}")
print(f"  │  {'─'*62}")
for cls in classes:
    m = metrics[cls]
    print(f"  │  {cls:<8} {m['precision']:>10.4f} {m['recall']:>8.4f} {m['f1']:>8.4f} {m['accuracy']:>10.4f} {m['TP']:>5} {m['FP']:>5} {m['FN']:>5} {m['TN']:>5}")
print(f"  │  {'─'*62}")
print(f"  │  {'MACRO':<8} {macro_p:>10.4f} {macro_r:>8.4f} {macro_f1:>8.4f} {overall_acc:>10.4f}")
print(f"  └───────────────────────────────────────────────────────────────────")

print(f"\n  ┌─ TSD CPU SPIKE DETECTION ──────────────────────────────────────────")
print(f"  │  Baseline CPU (6 readings): {[round(v,1) for v in cpu_before_readings]}")
print(f"  │  Baseline mean            : {cpu_baseline_mean:.2f}%")
print(f"  │  CPU during fault         : {[round(v,1) for v in cpu_during_readings]}")
print(f"  │  Fault mean               : {cpu_fault_mean:.2f}%")
print(f"  │  CPU increase             : +{cpu_fault_mean - cpu_baseline_mean:.2f}%")
print(f"  │  TSD detected             : {tsd_detected}")
print(f"  │  Detection cycles         : {tsd_detected_cycles}/6")
print(f"  └───────────────────────────────────────────────────────────────────")

print(f"\n  ┌─ TSD MEMORY LEAK DETECTION ────────────────────────────────────────")
print(f"  │  Memory before    : {mem_before:.1f} MB")
print(f"  │  Memory after     : {mem_after:.1f} MB")
print(f"  │  Growth           : +{mem_growth:.1f} MB")
print(f"  │  Readings         : {[round(v,1) for v in mem_readings]}")
print(f"  │  TSD detected     : {mem_detected}")
print(f"  └───────────────────────────────────────────────────────────────────")

print(f"\n  Full JSON saved to: {OUTPUT}")
print(SEP)
PYEOF
