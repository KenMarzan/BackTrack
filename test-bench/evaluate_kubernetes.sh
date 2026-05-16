#!/usr/bin/env bash
# ============================================================
# BackTrack Kubernetes Pod Evaluator
# Same output as evaluate.sh but uses kubectl instead of docker.
# Works on any Kubernetes deployment/pod.
#
# Requirements:
#   - kubectl configured and pointing to your cluster
#   - metrics-server installed in the cluster (for kubectl top)
#   - BackTrack agent running in kubernetes mode
#   - BACKTRACK_MODE=kubernetes in the agent
#
# Usage:
#   ./evaluate_kubernetes.sh <deployment-name> [namespace] [agent-url]
#
# Examples:
#   ./evaluate_kubernetes.sh food-delivery-app
#   ./evaluate_kubernetes.sh frontend default http://localhost:8847
#   ./evaluate_kubernetes.sh cartservice microservices http://localhost:8847
# ============================================================

DEPLOYMENT="${1:-food-delivery-app}"
NAMESPACE="${2:-default}"
AGENT_URL="${3:-http://localhost:8847}"

echo ""
echo "========================================================"
echo "  BACKTRACK KUBERNETES EVALUATION"
echo "  Deployment : $DEPLOYMENT"
echo "  Namespace  : $NAMESPACE"
echo "  Agent URL  : $AGENT_URL"
echo "  Time       : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

# ── Verify kubectl access ────────────────────────────────────
echo ""
echo "Verifying cluster access..."
if ! kubectl get deployment "$DEPLOYMENT" -n "$NAMESPACE" &>/dev/null; then
    echo "ERROR: Deployment '$DEPLOYMENT' not found in namespace '$NAMESPACE'"
    echo "Available deployments:"
    kubectl get deployments -n "$NAMESPACE" --no-headers 2>/dev/null | awk '{print "  " $1}'
    exit 1
fi

# Get a running pod name for this deployment
POD=$(kubectl get pods -n "$NAMESPACE" \
    --selector="app=$DEPLOYMENT" \
    --field-selector=status.phase=Running \
    --no-headers -o custom-columns=NAME:.metadata.name 2>/dev/null | head -1)

if [[ -z "$POD" ]]; then
    # Try broader search by deployment name substring
    POD=$(kubectl get pods -n "$NAMESPACE" --no-headers \
        -o custom-columns=NAME:.metadata.name,STATUS:.status.phase 2>/dev/null \
        | grep "Running" | grep "$DEPLOYMENT" | head -1 | awk '{print $1}')
fi

if [[ -z "$POD" ]]; then
    echo "ERROR: No running pod found for deployment '$DEPLOYMENT'"
    echo "Running pods in namespace '$NAMESPACE':"
    kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | awk '{print "  " $1 " " $3}'
    exit 1
fi

echo "Found pod: $POD"
echo ""

# ── Detect available runtime in pod ─────────────────────────
HAS_NODE=$(kubectl exec "$POD" -n "$NAMESPACE" -- sh -c "which node 2>/dev/null" 2>/dev/null)
HAS_PYTHON=$(kubectl exec "$POD" -n "$NAMESPACE" -- sh -c "which python3 2>/dev/null || which python 2>/dev/null" 2>/dev/null)
HAS_SHELL=$(kubectl exec "$POD" -n "$NAMESPACE" -- sh -c "which sh 2>/dev/null" 2>/dev/null)
echo "Runtime: node=${HAS_NODE:-none}  python=${HAS_PYTHON:-none}  sh=${HAS_SHELL:-none}"
echo ""

python3 - <<PYEOF
import json, time, subprocess, datetime, sys, os
import urllib.request

DEPLOYMENT = "$DEPLOYMENT"
NAMESPACE  = "$NAMESPACE"
AGENT_URL  = "$AGENT_URL"
POD        = "$POD"
HAS_NODE   = bool("$HAS_NODE".strip())
HAS_PYTHON = bool("$HAS_PYTHON".strip())
HAS_SHELL  = bool("$HAS_SHELL".strip())
OUTPUT     = f"evaluation_{DEPLOYMENT}_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

def fetch(path):
    try:
        with urllib.request.urlopen(f"{AGENT_URL}{path}", timeout=8) as r:
            return json.load(r)
    except Exception as e:
        return {"error": str(e)}

def kube_exec(cmd, background=False, timeout=15):
    """Run a command inside the pod via kubectl exec."""
    full = ["kubectl", "exec", POD, "-n", NAMESPACE, "--", "sh", "-c", cmd]
    try:
        if background:
            subprocess.Popen(full,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL)
            return ""
        result = subprocess.run(full, capture_output=True, text=True, timeout=timeout)
        return result.stdout + result.stderr
    except Exception as e:
        return str(e)

def kube_exec_background(cmd):
    """Run command in pod background."""
    full = ["kubectl", "exec", POD, "-n", NAMESPACE, "--", "sh", "-c", cmd]
    subprocess.Popen(full, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def kill_bg_in_pod(pattern):
    """Kill background processes inside the pod."""
    kube_exec(f"pkill -f '{pattern}' 2>/dev/null || true")

def kube_logs(lines=50):
    """Get recent logs from the pod."""
    try:
        result = subprocess.run(
            ["kubectl", "logs", POD, "-n", NAMESPACE, f"--tail={lines}"],
            capture_output=True, text=True, timeout=15
        )
        return result.stdout.strip().splitlines()
    except:
        return []

SEP = "=" * 64

# ── 0. Reset ─────────────────────────────────────────────────
print("\n[0] Cleaning leftover background processes in pod...", flush=True)
kill_bg_in_pod("stress_cpu")
kill_bg_in_pod("mem_leak")
time.sleep(2)

# ── 1. Baseline ───────────────────────────────────────────────
print("[1] Taking pre-fault baseline snapshot...", flush=True)
baseline_tsd = fetch(f"/metrics?service={DEPLOYMENT}")
baseline_lsi = fetch(f"/lsi?service={DEPLOYMENT}")
if "error" in baseline_tsd:
    print(f"    WARNING: Could not reach agent — {baseline_tsd['error']}")
    print(f"    Make sure BackTrack agent is running in kubernetes mode")
    print(f"    and is monitoring namespace '{NAMESPACE}'")
b_reads = baseline_tsd.get("readings_count", 0)
b_cpu   = baseline_tsd.get("current", {}).get("cpu_percent", 0)
b_mem   = baseline_tsd.get("current", {}).get("memory_mb", 0)
print(f"    readings={b_reads}  cpu={b_cpu:.2f}%  mem={b_mem:.1f}MB")

# ── 2. LSI Log Classification ─────────────────────────────────
print(f"\n[2] LSI Log Classification Evaluation", flush=True)

ERROR_PATTERNS = [
    "error","exception","failed","crash","traceback","fatal",
    "refused","timeout","unavailable","panic","500","503",
    "NullPointerException","NullReferenceException","deadlock",
    "unauthorized","forbidden","out of memory",
]

print(f"    Injecting 200 ERROR log lines into pod {POD}...", flush=True)

if HAS_NODE:
    # Node.js error injection
    error_script = (
        "const e=["
        "'ERROR: NullPointerException in OrderService.processOrder() line 142',"
        "'ERROR: Connection refused to postgres host:5432 database unreachable',"
        "'ERROR: HTTP 500 Internal Server Error on POST /api/checkout',"
        "'ERROR: Timeout 5000ms waiting for payment-service response',"
        "'ERROR: Out of memory failed to allocate buffer for request',"
        "'ERROR: Deadlock detected in transaction manager rolling back',"
        "'ERROR: JWT token validation failed unauthorized request',"
        "'ERROR: RabbitMQ connection lost message queue unavailable',"
        "'ERROR: MongoDB write concern timeout on orders collection',"
        "'ERROR: Rate limit exceeded on upstream API 429 Too Many Requests',"
        "];"
        "let n=0;"
        "const iv=setInterval(()=>{"
        "if(n>=200){clearInterval(iv);}"
        "else{process.stderr.write(e[n%e.length]+' occurrence='+n+'\\n');n++;}"
        "},200);"
    )
    subprocess.Popen(
        ["kubectl","exec",POD,"-n",NAMESPACE,"--","node","-e",error_script],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
elif HAS_PYTHON:
    # Python error injection
    py_script = (
        "import time,sys;"
        "errors=['ERROR: NullPointerException in Service','ERROR: Connection refused to database',"
        "'ERROR: HTTP 500 Internal Server Error','ERROR: Timeout waiting for upstream',"
        "'ERROR: Out of memory failed to allocate','ERROR: Deadlock detected rolling back'];"
        "[sys.stderr.write(errors[i%len(errors)]+f' occurrence={i}\\n') or time.sleep(0.2) for i in range(200)]"
    )
    subprocess.Popen(
        ["kubectl","exec",POD,"-n",NAMESPACE,"--","python3","-c",py_script],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
else:
    # Shell fallback — printf to stderr
    kube_exec_background(
        "for i in $(seq 1 200); do "
        "echo 'ERROR: Connection refused to database host attempt '$i' failed' >&2; "
        "sleep 0.2; done"
    )

# Wait 90s — 3 full LSI windows
print(f"    Waiting 90s for LSI windows to close and classify...", flush=True)
peak_error_score = 0.0
peak_detected    = False
lsi_at_peak      = None
for i in range(18):
    time.sleep(5)
    lsi_now     = fetch(f"/lsi?service={DEPLOYMENT}")
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
    sys.stdout.write(
        f"\r    [{(i+1)*5}s] score={score:.4f}  error_score={error_score:.4f}  detected={detected}   "
    )
    sys.stdout.flush()
print()
print(f"    {'✓ Anomaly detected' if peak_detected else '✗ Not detected'}"
      f" (peak error_score={peak_error_score:.4f})")

lsi_after    = lsi_at_peak or fetch(f"/lsi?service={DEPLOYMENT}")
lsi_detected = peak_detected

# Compute ground truth from recent_lines
classified_lines = lsi_after.get("recent_lines", [])
results = []
for entry in classified_lines:
    line      = entry.get("line", "")
    predicted = entry.get("label", "INFO")
    is_error  = any(p.lower() in line.lower() for p in ERROR_PATTERNS)
    gt        = "ERROR" if is_error else "INFO"
    results.append((gt, predicted))

classes = ["INFO","WARN","ERROR","NOVEL"]
metrics = {}
for cls in classes:
    TP = sum(1 for gt,pr in results if gt==cls and pr==cls)
    FP = sum(1 for gt,pr in results if gt!=cls and pr==cls)
    FN = sum(1 for gt,pr in results if gt==cls and pr!=cls)
    TN = sum(1 for gt,pr in results if gt!=cls and pr!=cls)
    pr_val = TP/(TP+FP) if (TP+FP)>0 else 0.0
    rc_val = TP/(TP+FN) if (TP+FN)>0 else 0.0
    f1_val = 2*pr_val*rc_val/(pr_val+rc_val) if (pr_val+rc_val)>0 else 0.0
    ac_val = (TP+TN)/(TP+FP+FN+TN) if (TP+FP+FN+TN)>0 else 0.0
    metrics[cls] = dict(TP=TP,FP=FP,FN=FN,TN=TN,
                        precision=round(pr_val,4),
                        recall=round(rc_val,4),
                        f1=round(f1_val,4),
                        accuracy=round(ac_val,4))

err_inj  = sum(1 for gt,_ in results if gt=="ERROR")
info_cnt = sum(1 for gt,_ in results if gt=="INFO")
macro_p  = (metrics["INFO"]["precision"] + metrics["ERROR"]["precision"]) / 2
macro_r  = (metrics["INFO"]["recall"]    + metrics["ERROR"]["recall"])    / 2
macro_f1 = (metrics["INFO"]["f1"]        + metrics["ERROR"]["f1"])        / 2
overall_acc = sum(metrics[c]["TP"] for c in classes) / max(1, len(results))

# ── 3. TSD CPU Spike ──────────────────────────────────────────
print(f"\n[3] TSD CPU Spike Evaluation...", flush=True)
kill_bg_in_pod("stress_cpu")
time.sleep(3)

# Baseline CPU readings
cpu_before = []
for i in range(6):
    t = fetch(f"/metrics?service={DEPLOYMENT}")
    cpu_before.append(t.get("current",{}).get("cpu_percent",0))
    time.sleep(10)
cpu_base_mean = sum(cpu_before)/len(cpu_before)
print(f"    CPU baseline (6 readings): {[round(v,2) for v in cpu_before]}")
print(f"    Baseline mean: {cpu_base_mean:.2f}%")

# Inject CPU spike
print(f"    Injecting CPU spike into pod {POD}...", flush=True)
if HAS_NODE:
    cpu_script = "while(true){ let x=0; for(let i=0;i<1e7;i++) x+=i; }"
    for _ in range(4):
        subprocess.Popen(
            ["kubectl","exec",POD,"-n",NAMESPACE,"--","node","-e",cpu_script],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
elif HAS_PYTHON:
    py_cpu = "while True: sum(range(10**6))"
    for _ in range(4):
        subprocess.Popen(
            ["kubectl","exec",POD,"-n",NAMESPACE,"--","python3","-c",py_cpu],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
else:
    kube_exec_background(
        "for i in 1 2 3 4; do (while true; do :; done) & done; sleep 60; kill 0"
    )

# Collect CPU during fault
cpu_during = []
tsd_detected_cpu  = False
cpu_detect_cycles = 0
for i in range(6):
    time.sleep(10)
    t        = fetch(f"/metrics?service={DEPLOYMENT}")
    cpu_val  = t.get("current",{}).get("cpu_percent",0)
    drifting = t.get("is_drifting", False)
    cpu_during.append(cpu_val)
    if drifting:
        tsd_detected_cpu = True
        cpu_detect_cycles += 1
    sys.stdout.write(f"\r    Reading {i+1}/6: cpu={cpu_val:.1f}%  drifting={drifting}   ")
    sys.stdout.flush()
print()
cpu_fault_mean = sum(cpu_during)/len(cpu_during)

# Kill CPU burners
kill_bg_in_pod("node -e while")
kill_bg_in_pod("python3 -c while")
kill_bg_in_pod("while true")
time.sleep(5)

# ── 4. TSD Memory Leak ────────────────────────────────────────
print(f"\n[4] TSD Memory Leak Evaluation...", flush=True)
mem_before_val = fetch(f"/metrics?service={DEPLOYMENT}").get("current",{}).get("memory_mb",0)
print(f"    Memory before: {mem_before_val:.1f} MB")

print(f"    Injecting memory leak into pod {POD}...", flush=True)
if HAS_NODE:
    mem_script = (
        "const c=[];"
        "let n=0;"
        "const iv=setInterval(()=>{"
        "if(n>=20)clearInterval(iv);"
        "else{c.push(Buffer.alloc(10*1024*1024,0));n++;}"
        "},2000);"
    )
    subprocess.Popen(
        ["kubectl","exec",POD,"-n",NAMESPACE,"--","node","-e",mem_script],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
elif HAS_PYTHON:
    py_mem = (
        "import time;"
        "chunks=[];"
        "[chunks.append(b'x'*10*1024*1024) or time.sleep(2) for _ in range(20)]"
    )
    subprocess.Popen(
        ["kubectl","exec",POD,"-n",NAMESPACE,"--","python3","-c",py_mem],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
else:
    kube_exec_background("dd if=/dev/zero of=/tmp/memfile bs=10M count=20 2>/dev/null")

# Collect memory during fault
mem_readings     = []
tsd_detected_mem = False
for i in range(8):
    time.sleep(10)
    t        = fetch(f"/metrics?service={DEPLOYMENT}")
    mem_val  = t.get("current",{}).get("memory_mb",0)
    drifting = t.get("is_drifting", False)
    mem_readings.append(mem_val)
    if drifting:
        tsd_detected_mem = True
    sys.stdout.write(f"\r    Reading {i+1}/8: mem={mem_val:.1f}MB  drifting={drifting}   ")
    sys.stdout.flush()
print()
mem_after_val = mem_readings[-1] if mem_readings else 0
mem_growth    = mem_after_val - mem_before_val

kill_bg_in_pod("Buffer.alloc")
kill_bg_in_pod("chunks.append")
kube_exec("rm -f /tmp/memfile 2>/dev/null || true")

# ── 5. Save report ────────────────────────────────────────────
report = {
    "app":          DEPLOYMENT,
    "namespace":    NAMESPACE,
    "pod":          POD,
    "platform":     "kubernetes",
    "evaluated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),

    "lsi_evaluation": {
        "total_lines_evaluated":  len(results),
        "ground_truth_breakdown": {
            "ERROR_lines_injected": err_inj,
            "INFO_lines_baseline":  info_cnt,
        },
        "anomaly_detected":  lsi_detected,
        "current_score":     lsi_after.get("current_score"),
        "baseline_mean":     lsi_after.get("baseline_mean"),
        "threshold":         lsi_after.get("threshold"),
        "per_class_metrics": metrics,
        "macro_averages": {
            "precision": round(macro_p, 4),
            "recall":    round(macro_r, 4),
            "f1":        round(macro_f1,4),
        },
        "overall_accuracy": round(overall_acc, 4),
    },

    "tsd_cpu_evaluation": {
        "cpu_baseline_readings": [round(v,2) for v in cpu_before],
        "cpu_baseline_mean":     round(cpu_base_mean,2),
        "cpu_during_fault":      [round(v,2) for v in cpu_during],
        "cpu_fault_mean":        round(cpu_fault_mean,2),
        "tsd_detected":          tsd_detected_cpu,
        "detection_cycles":      cpu_detect_cycles,
    },

    "tsd_memory_evaluation": {
        "memory_before_mb":  round(mem_before_val,2),
        "memory_after_mb":   round(mem_after_val,2),
        "memory_growth_mb":  round(mem_growth,2),
        "memory_readings":   [round(v,2) for v in mem_readings],
        "tsd_detected":      tsd_detected_mem,
    },
}

with open(OUTPUT, "w") as f:
    json.dump(report, f, indent=2)

# ── Print results ─────────────────────────────────────────────
print(f"\n{SEP}")
print(f"  KUBERNETES EVALUATION — {DEPLOYMENT} ({NAMESPACE}/{POD})")
print(SEP)

print(f"\n  ┌─ LSI LOG CLASSIFICATION ──────────────────────────────────────")
print(f"  │  Lines evaluated       : {len(results)}")
print(f"  │  ERROR lines (injected): {err_inj}  (ground truth = ERROR)")
print(f"  │  INFO  lines (baseline): {info_cnt}  (ground truth = INFO)")
print(f"  │  Anomaly detected      : {lsi_detected}")
print(f"  │  Score / Baseline / Threshold: {lsi_after.get('current_score',0):.4f} / "
      f"{lsi_after.get('baseline_mean',0):.4f} / {lsi_after.get('threshold',0):.4f}")
print(f"  │")
print(f"  │  {'Class':<8} {'Precision':>10} {'Recall':>8} {'F1':>8} {'TP':>5} {'FP':>5} {'FN':>5} {'TN':>5}")
print(f"  │  {'─'*60}")
for cls in classes:
    m = metrics[cls]
    print(f"  │  {cls:<8} {m['precision']:>10.4f} {m['recall']:>8.4f} {m['f1']:>8.4f}"
          f" {m['TP']:>5} {m['FP']:>5} {m['FN']:>5} {m['TN']:>5}")
print(f"  │  {'─'*60}")
print(f"  │  {'MACRO':<8} {macro_p:>10.4f} {macro_r:>8.4f} {macro_f1:>8.4f}")
print(f"  └───────────────────────────────────────────────────────────────")

print(f"\n  ┌─ TSD CPU SPIKE DETECTION ──────────────────────────────────────")
print(f"  │  Baseline (6 readings): {[round(v,1) for v in cpu_before]}")
print(f"  │  Baseline mean        : {cpu_base_mean:.2f}%")
print(f"  │  During fault         : {[round(v,1) for v in cpu_during]}")
print(f"  │  Fault mean           : {cpu_fault_mean:.2f}%")
print(f"  │  Increase             : +{cpu_fault_mean-cpu_base_mean:.2f}%")
print(f"  │  TSD detected         : {tsd_detected_cpu}")
print(f"  │  Detection cycles     : {cpu_detect_cycles}/6")
print(f"  └───────────────────────────────────────────────────────────────")

print(f"\n  ┌─ TSD MEMORY LEAK DETECTION ────────────────────────────────────")
pct = (mem_growth/mem_before_val*100) if mem_before_val>0 else 0
print(f"  │  Memory before    : {mem_before_val:.1f} MB")
print(f"  │  Memory after     : {mem_after_val:.1f} MB")
print(f"  │  Growth           : +{mem_growth:.1f} MB  (+{pct:.1f}%)")
print(f"  │  Readings         : {[round(v,1) for v in mem_readings]}")
print(f"  │  TSD detected     : {tsd_detected_mem}")
print(f"  └───────────────────────────────────────────────────────────────")

print(f"\n  Full JSON saved to: {OUTPUT}")
print(SEP)
PYEOF
