#!/usr/bin/env bash
# ============================================================
# BackTrack Production App Ground-Truth Evaluator
# Works on ANY Docker container using docker exec.
# Same output format as evaluate.sh — feeds into thesis report.
#
# Usage: ./evaluate_production.sh <container-name>
# Examples:
#   ./evaluate_production.sh food-delivery-app
#   ./evaluate_production.sh postgres
#   ./evaluate_production.sh mongo
#   ./evaluate_production.sh rabbitmq
#   ./evaluate_production.sh redis
# ============================================================

APP="${1:-food-delivery-app}"
AGENT_URL="http://localhost:8847"

echo ""
echo "========================================================"
echo "  BACKTRACK PRODUCTION EVALUATION"
echo "  App: $APP"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"

# ── Detect what shell/runtime is available ───────────────────
HAS_NODE=$(docker exec "$APP" sh -c "which node 2>/dev/null" 2>/dev/null)
HAS_PSQL=$(docker exec "$APP" sh -c "which psql 2>/dev/null" 2>/dev/null)
HAS_MONGO=$(docker exec "$APP" sh -c "which mongosh 2>/dev/null || which mongo 2>/dev/null" 2>/dev/null)
HAS_REDIS=$(docker exec "$APP" sh -c "which redis-cli 2>/dev/null" 2>/dev/null)

echo "  Runtime detected: node=${HAS_NODE:-none} psql=${HAS_PSQL:-none} mongo=${HAS_MONGO:-none} redis=${HAS_REDIS:-none}"
echo ""

python3 - <<PYEOF
import json, time, subprocess, datetime, sys, os

AGENT_URL = "$AGENT_URL"
APP       = "$APP"
HAS_NODE  = bool("$HAS_NODE".strip())
HAS_PSQL  = bool("$HAS_PSQL".strip())
HAS_MONGO = bool("$HAS_MONGO".strip())
HAS_REDIS = bool("$HAS_REDIS".strip())
OUTPUT    = f"evaluation_{APP}_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

import urllib.request

def fetch(path):
    try:
        with urllib.request.urlopen(f"{AGENT_URL}{path}", timeout=8) as r:
            return json.load(r)
    except Exception as e:
        return {"error": str(e)}

def run(cmd, background=False, timeout=10):
    """Run a command inside the container."""
    full = ["docker", "exec"] + (["-d"] if background else []) + [APP, "sh", "-c", cmd]
    try:
        if background:
            subprocess.Popen(full, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return ""
        result = subprocess.run(full, capture_output=True, text=True, timeout=timeout)
        return result.stdout + result.stderr
    except Exception as e:
        return str(e)

def kill_bg(pattern):
    """Kill background processes we started inside the container."""
    run(f"pkill -f '{pattern}' 2>/dev/null || true")

SEP = "=" * 64

# ── 0. Reset / clean state ────────────────────────────────────
print("\n[0] Cleaning any leftover background processes...", flush=True)
kill_bg("stress_cpu")
kill_bg("mem_leak")
time.sleep(2)

# ── 1. Pre-fault baseline ─────────────────────────────────────
print("[1] Taking pre-fault baseline snapshot...", flush=True)
baseline_tsd = fetch(f"/metrics?service={APP}")
baseline_lsi = fetch(f"/lsi?service={APP}")
baseline_readings = baseline_tsd.get("readings_count", 0)
baseline_cpu      = baseline_tsd.get("current", {}).get("cpu_percent", 0)
baseline_mem      = baseline_tsd.get("current", {}).get("memory_mb", 0)
print(f"    readings={baseline_readings}  cpu={baseline_cpu:.2f}%  mem={baseline_mem:.1f}MB")

# ── 2. LSI LOG CLASSIFICATION ─────────────────────────────────
print(f"\n[2] LSI Log Classification Evaluation", flush=True)

ERROR_PATTERNS = [
    "NullPointerException","NullReferenceException","Connection refused",
    "HTTP 500","Out of memory","Deadlock","JWT","RabbitMQ","MongoDB",
    "Rate limit","Timeout","FATAL","Exception","Error","ERROR",
    "failed","refused","timeout","unauthorized","unavailable",
]

# Inject error logs — method depends on runtime available
print(f"    Injecting 200 ERROR log lines via docker exec...", flush=True)

if HAS_NODE:
    # Node.js: console.error goes to stderr → captured by docker logs
    error_script = r"""
const errors = [
  'ERROR: NullReferenceException in OrderService.processOrder() line 142',
  'ERROR: Connection refused to PostgreSQL host:5432 database unreachable',
  'ERROR: HTTP 500 Internal Server Error on POST /api/orders/checkout',
  'ERROR: Timeout 5000ms waiting for payment-service response',
  'ERROR: Out of memory failed to allocate buffer for order processing',
  'ERROR: Deadlock detected in transaction manager rolling back order',
  'ERROR: JWT token validation failed unauthorized request rejected',
  'ERROR: RabbitMQ connection lost message queue unavailable',
  'ERROR: MongoDB write concern timeout on orders collection',
  'ERROR: Rate limit exceeded on delivery-service API 429 Too Many Requests',
];
let count = 0;
const iv = setInterval(() => {
  if (count >= 200) { clearInterval(iv); }
  else { process.stderr.write(errors[count % errors.length] + ' occurrence=' + (count+1) + '\n'); count++; }
}, 200);
"""
    proc = subprocess.Popen(
        ["docker","exec",APP,"node","-e", error_script],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
elif HAS_PSQL:
    # Postgres: run bad SQL queries to generate real ERROR logs
    print("    Using psql bad queries for LSI error generation...", flush=True)
    for i in range(50):
        run(f"psql -U postgres -c \"SELECT * FROM nonexistent_table_{i};\" 2>&1 || true", timeout=5)
    proc = None
elif HAS_MONGO:
    # MongoDB: run bad queries
    print("    Using mongosh bad queries for LSI error generation...", flush=True)
    for i in range(50):
        run(f"mongosh --quiet --eval \"db.getSiblingDB('bad_{i}').x.findOne()\" 2>&1 || true", timeout=5)
    proc = None
elif HAS_REDIS:
    # Redis: send invalid commands
    print("    Using redis-cli invalid commands for LSI error generation...", flush=True)
    for i in range(200):
        run(f"redis-cli BADCMD{i} arg 2>&1 || true", timeout=2)
    proc = None
else:
    # Generic shell fallback: write directly to stderr
    print("    Using shell printf for LSI error generation...", flush=True)
    error_lines = "\n".join([
        f"ERROR: Connection refused to database host attempt {i}"
        for i in range(200)
    ])
    run(f"printf '{error_lines}' >&2 &", background=True)
    proc = None

# Wait 90s — covers at least 2 full 30s LSI windows
print(f"    Waiting 90s for LSI windows to close and classify...", flush=True)
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
    print(f"    Peak error_score: {peak_error_score:.4f} — not detected above threshold")

lsi_after = lsi_at_peak or fetch(f"/lsi?service={APP}")
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
    precision = TP/(TP+FP) if (TP+FP)>0 else 0.0
    recall    = TP/(TP+FN) if (TP+FN)>0 else 0.0
    f1        = 2*precision*recall/(precision+recall) if (precision+recall)>0 else 0.0
    accuracy  = (TP+TN)/(TP+FP+FN+TN) if (TP+FP+FN+TN)>0 else 0.0
    metrics[cls] = dict(TP=TP,FP=FP,FN=FN,TN=TN,
                        precision=round(precision,4),
                        recall=round(recall,4),
                        f1=round(f1,4),
                        accuracy=round(accuracy,4))

err_inj  = sum(1 for gt,_ in results if gt=="ERROR")
info_cnt = sum(1 for gt,_ in results if gt=="INFO")
main     = ["INFO","ERROR"]
macro_p  = sum(metrics[c]["precision"] for c in main)/len(main)
macro_r  = sum(metrics[c]["recall"]    for c in main)/len(main)
macro_f1 = sum(metrics[c]["f1"]        for c in main)/len(main)
overall_acc = sum(metrics[c]["TP"] for c in classes) / max(1, len(results))

def cm_metrics(TP, FN, TN, FP):
    precision = TP / (TP + FP) if (TP + FP) > 0 else 0.0
    recall    = TP / (TP + FN) if (TP + FN) > 0 else 0.0
    f1        = 2*precision*recall / (precision+recall) if (precision+recall) > 0 else 0.0
    accuracy  = (TP + TN) / (TP + TN + FP + FN) if (TP + TN + FP + FN) > 0 else 0.0
    return round(precision,4), round(recall,4), round(f1,4), round(accuracy,4)

def lsi_line_cm(snap):
    """Per-line (TP, FP, FN, TN) for ERROR vs INFO from recent_lines snapshot."""
    tp = fp = fn = tn = 0
    for entry in snap.get("recent_lines", []):
        line = entry.get("line", "")
        predicted = entry.get("label", "INFO")
        is_error_gt = any(p.lower() in line.lower() for p in ERROR_PATTERNS)
        predicted_error = predicted not in ("INFO", "WARN")
        if is_error_gt and predicted_error:       tp += 1
        elif is_error_gt and not predicted_error: fn += 1
        elif not is_error_gt and predicted_error: fp += 1
        else:                                     tn += 1
    return tp, fp, fn, tn

def inject_lines(lines, n=200, interval_s=0.2):
    """Inject n log lines (cycling through lines) into the container stdout."""
    if HAS_NODE:
        arr = ",".join(f"'{l}'" for l in lines)
        script = (
            f"const fs=require('fs');const e=[{arr}];"
            f"let i=0;const iv=setInterval(()=>{{"
            f"if(i>={n}){{clearInterval(iv);}}"
            f"else{{fs.appendFileSync('/proc/1/fd/1',e[i%e.length]+' occ='+i+'\\n');i++;}}"
            f"}},{int(interval_s*1000)});"
        )
        subprocess.Popen(
            ["docker", "exec", APP, "node", "-e", script],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
    else:
        n_l = len(lines)
        cases = " ".join(f"{i}) MSG='{l}';;" for i, l in enumerate(lines))
        cmd = (
            f"i=0; while [ $i -lt {n} ]; do "
            f"case $((i % {n_l})) in {cases} esac; "
            f"printf '%s occ=%d\\n' \"$MSG\" $i > /proc/1/fd/1; "
            f"i=$((i+1)); sleep {interval_s}; done"
        )
        subprocess.Popen(
            ["docker", "exec", APP, "sh", "-c", cmd],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

def poll_lsi_window(n=10, interval=5, threshold=None):
    """Poll LSI for n×interval s. Returns (detected, peak_error_score, last_snap)."""
    detected = False
    peak = 0.0
    agent_threshold = threshold
    last_snap = {}
    for i in range(n):
        time.sleep(interval)
        lsi = fetch(f"/lsi?service={APP}")
        score = lsi.get("error_score", 0)
        fired = lsi.get("is_error_anomalous", False)
        if agent_threshold is None:
            agent_threshold = lsi.get("threshold", 1.5)
        if score > peak: peak = score
        if fired: detected = True
        last_snap = lsi
        sys.stdout.write(
            f"\r        [{(i+1)*interval}s/{n*interval}s] error_score={score:.4f}  anomalous={fired}   "
        )
        sys.stdout.flush()
    print()
    if not detected and agent_threshold is not None and peak > agent_threshold:
        detected = True
    return detected, round(peak, 4), last_snap

NORMAL_LINES = [
    "[INFO] GET /api/v1/health 200 12ms",
    "[INFO] database connection pool: 4/10 connections active",
    "[INFO] processed order ORD-12345 successfully in 45ms",
    "[INFO] cache hit for product SKU-1234 (ratio: 0.87)",
    "[INFO] heartbeat: all replicas healthy",
    "[INFO] grpc call to recommendation-service 200 23ms",
    "[INFO] payment processed: txn-8821 amount=42.50 USD in 38ms",
    "[INFO] user session refreshed: uid-4421 token extended 1h",
    "[INFO] config reload: 0 changes detected",
    "[INFO] metrics exported: 142 data points flushed",
]

INJECTOR_FAULT_TYPES = {
    "lsi-error-flood": [
        "[ERROR] fatal: connection refused -- db unreachable",
        "[ERROR] exception: NullPointerException in PaymentService.process()",
        "[FATAL] crash: segfault at 0x0 in core.so",
        "[ERROR] HTTP 503 upstream timeout after 30s",
    ],
    "lsi-connection-refused": [
        "[ERROR] connection refused: dial tcp 10.0.0.5:5432 connect: connection refused",
        "[ERROR] failed to connect to redis: connection refused (host=redis:6379)",
        "[ERROR] grpc: failed to connect to db-service: connection refused after 3 retries",
    ],
    "lsi-timeout": [
        "[ERROR] timeout: context deadline exceeded after 30s waiting for db-service",
        "[ERROR] request timeout: grpc call to recommendation-service timed out after 5000ms",
        "[ERROR] connection timeout: failed to reach payment-service:8080 in 10s",
    ],
    "lsi-oom": [
        "[ERROR] java.lang.OutOfMemoryError: Java heap space -- cannot allocate 524288 bytes",
        "[ERROR] fatal: out of memory -- runtime requested 1073741824 bytes",
        "[ERROR] OOM killer invoked: out of memory condition, process terminated",
    ],
    "lsi-null-pointer": [
        "[ERROR] NullPointerException: cannot invoke getId() on null reference in UserService.java:87",
        "[ERROR] null pointer dereference: attempt to read field userId on null object",
        "[ERROR] java.lang.NullPointerException at OrderService.process(OrderService.java:142)",
    ],
    "lsi-permission-denied": [
        "[ERROR] permission denied: user api-service lacks WRITE access on orders table",
        "[ERROR] authorization failed: permission denied for resource /admin/users (403)",
        "[ERROR] forbidden: permission denied for operation DeleteBucket on storage-service",
    ],
    "lsi-not-found": [
        "[ERROR] 404 not found: resource /api/v1/orders/99999 does not exist",
        "[ERROR] not found: product SKU-4892 missing from catalog service",
        "[ERROR] ResourceNotFoundError: user uid-8842 not found in user-service",
    ],
    "lsi-deadlock": [
        "[ERROR] deadlock detected: transaction lock timeout on orders table after 30s",
        "[ERROR] deadlock: goroutine 142 waiting on mutex held by goroutine 87",
        "[ERROR] deadlock: cycle detected in lock dependency graph -- aborting transaction",
    ],
    "lsi-panic": [
        "panic: runtime error: index out of range [4] with length 3",
        "goroutine 1 [running]:",
        "[ERROR] panic: interface conversion: interface {} is nil, not *Order",
    ],
    "lsi-http-500": [
        "[ERROR] 500 POST /api/v1/checkout 142ms -- internal server error in PaymentHandler",
        "[ERROR] HTTP 500: upstream service failed -- unexpected error in order-service",
        "[ERROR] 500 GET /api/v1/cart/99 213ms -- unhandled exception",
    ],
    "lsi-http-503": [
        "[ERROR] HTTP 503 Service Unavailable: circuit breaker open for payment-service",
        "[ERROR] upstream returned 503: recommendation-service temporarily unavailable",
        "[ERROR] 503 GET /api/v1/recommendations 1204ms -- service unavailable",
    ],
    "lsi-http-429": [
        "[WARN] HTTP 429 Too Many Requests: rate limit exceeded for client 10.0.1.42",
        "[ERROR] 429 POST /api/v1/checkout 12ms -- rate limited (1250 req/min > 1000 limit)",
        "[WARN] rate limiter: 429 response to api-gateway -- backing off for 5s",
    ],
    "lsi-traceback": [
        "Traceback (most recent call last):",
        "  File \"/app/service.py\", line 142, in process_request",
        "DatabaseError: connection lost to postgres:5432",
        "[ERROR] unhandled exception in request handler",
    ],
}

# ── 2b. Per-fault-type LSI Detection Tests ────────────────────
print(f"\n[2b] Per-fault-type LSI Detection Tests (13 types)...", flush=True)
print(f"     Each test: 200 fault lines + 50s window → TP/FN", flush=True)
print(f"     Shared normal: 200 normal lines + 50s window → TN/FP", flush=True)

fault_type_results = {}
for ft_name, ft_lines in INJECTOR_FAULT_TYPES.items():
    print(f"\n    [{ft_name}]", flush=True)
    print(f"      [A-fault ] injecting 200 lines, 50s window...", flush=True)
    inject_lines(ft_lines, n=200, interval_s=0.2)
    A_detected, A_peak, A_snap = poll_lsi_window(n=10)
    A_tp, A_fp, A_fn, A_tn = lsi_line_cm(A_snap)
    print(f"      {'TP' if A_detected else 'FN'}  TP={A_tp} FN={A_fn}  peak_score={A_peak:.4f}")
    fault_type_results[ft_name] = {
        "TP": A_tp, "FN": A_fn,
        "fault_peak_error_score": A_peak,
    }

# Shared normal window (runs once for all 13 fault types)
print(f"\n      [settle  ] 20s for score to decay...", flush=True)
time.sleep(20)
print(f"\n    [LSI — shared normal injection (200 lines, 50s window)]", flush=True)
inject_lines(NORMAL_LINES, n=200, interval_s=0.2)
lsi_B_detected, lsi_B_peak, lsi_B_snap = poll_lsi_window(n=10)
_, lsi_FP, _, lsi_TN = lsi_line_cm(lsi_B_snap)
print(f"      {'FP' if lsi_FP else 'TN'}  TN={lsi_TN} FP={lsi_FP}  peak_score={lsi_B_peak:.4f}")

for ft_name in list(fault_type_results):
    r = fault_type_results[ft_name]
    prec, rec, f1, acc = cm_metrics(r["TP"], r["FN"], lsi_TN, lsi_FP)
    fault_type_results[ft_name].update({
        "TN": lsi_TN, "FP": lsi_FP,
        "precision": prec, "recall": rec, "f1": f1, "accuracy": acc,
        "normal_peak_error_score": lsi_B_peak,
    })

ft_total          = len(fault_type_results)
ft_detected_count = sum(1 for v in fault_type_results.values() if v["TP"] > 0)
lsi_agg_TP = sum(r["TP"] for r in fault_type_results.values())
lsi_agg_FN = sum(r["FN"] for r in fault_type_results.values())
lsi_agg_prec, lsi_agg_rec, lsi_agg_f1, lsi_agg_acc = cm_metrics(lsi_agg_TP, lsi_agg_FN, lsi_TN, lsi_FP)
print(f"\n    LSI per-fault: {ft_detected_count}/{ft_total} fault types → TP  |  normal: TN={lsi_TN} FP={lsi_FP}")
print(f"    Aggregate — TP={lsi_agg_TP} FN={lsi_agg_FN} TN={lsi_TN} FP={lsi_FP}  "
      f"P={lsi_agg_prec:.4f} R={lsi_agg_rec:.4f} F1={lsi_agg_f1:.4f}")

def poll_tsd_cpu(n, interval=10):
    """Poll TSD CPU n times. Returns (detected, readings, drift_flags)."""
    detected = False
    readings = []
    flags = []
    for i in range(n):
        time.sleep(interval)
        t = fetch(f"/metrics?service={APP}")
        cpu = t.get("current", {}).get("cpu_percent", 0)
        drift = t.get("is_drifting", False)
        readings.append(round(cpu, 2))
        flags.append(drift)
        if drift: detected = True
        sys.stdout.write(f"\r    Reading {i+1}/{n}: cpu={cpu:.1f}%  drifting={drift}   ")
        sys.stdout.flush()
    print()
    return detected, readings, flags

def poll_tsd_mem(n, interval=10):
    """Poll TSD memory n times. Returns (detected, readings, drift_flags)."""
    detected = False
    readings = []
    flags = []
    for i in range(n):
        time.sleep(interval)
        t = fetch(f"/metrics?service={APP}")
        mem = t.get("current", {}).get("memory_mb", 0)
        drift = t.get("is_drifting", False)
        readings.append(round(mem, 2))
        flags.append(drift)
        if drift: detected = True
        sys.stdout.write(f"\r    Reading {i+1}/{n}: mem={mem:.1f}MB  drifting={drift}   ")
        sys.stdout.flush()
    print()
    return detected, readings, flags

# ── 3. TSD CPU SPIKE ──────────────────────────────────────────
print(f"\n[3] TSD CPU Spike Evaluation...", flush=True)
kill_bg("stress_cpu")
time.sleep(3)

# Collect 6 clean baseline CPU readings
cpu_before = []
for i in range(6):
    t = fetch(f"/metrics?service={APP}")
    cpu_before.append(t.get("current",{}).get("cpu_percent",0))
    time.sleep(10)
cpu_base_mean = sum(cpu_before)/len(cpu_before)
print(f"    CPU baseline (6 readings): {[round(v,2) for v in cpu_before]}")
print(f"    Baseline mean: {cpu_base_mean:.2f}%")

# Inject CPU spike — spin multiple busy loops
print(f"    Injecting CPU spike (4 busy loops)...", flush=True)
if HAS_NODE:
    # Node.js CPU burn
    cpu_script = "while(true){ let x=0; for(let i=0;i<1e7;i++) x+=i; }"
    for _ in range(4):
        subprocess.Popen(
            ["docker","exec",APP,"node","-e", cpu_script],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
else:
    # Shell busy loop fallback
    run("for i in 1 2 3 4; do (while true; do :; done) & done", background=True)

# Collect 6 readings during fault (fault window)
print(f"    [fault   ] 60s poll...", flush=True)
tsd_detected_cpu, cpu_during, cpu_fault_flags = poll_tsd_cpu(6)
cpu_fault_mean    = sum(cpu_during) / len(cpu_during)
cpu_detect_cycles = sum(1 for f in cpu_fault_flags if f)

# Kill CPU burners and settle
kill_bg("node -e while")
kill_bg("while true")
print(f"    [settle  ] 30s for CPU to return to baseline...", flush=True)
time.sleep(30)

# Collect 5 baseline readings (normal window) for TN/FP
print(f"    [baseline] 50s poll (no injection)...", flush=True)
_, cpu_normal, cpu_normal_flags = poll_tsd_cpu(5)
cpu_normal_mean = sum(cpu_normal) / len(cpu_normal)

TP_cpu = sum(1 for f in cpu_fault_flags  if f)
FN_cpu = sum(1 for f in cpu_fault_flags  if not f)
TN_cpu = sum(1 for f in cpu_normal_flags if not f)
FP_cpu = sum(1 for f in cpu_normal_flags if f)
prec_cpu, rec_cpu, f1_cpu, acc_cpu = cm_metrics(TP_cpu, FN_cpu, TN_cpu, FP_cpu)

# ── 4. TSD MEMORY LEAK ────────────────────────────────────────
print(f"\n[4] TSD Memory Leak Evaluation...", flush=True)
mem_before_val = fetch(f"/metrics?service={APP}").get("current",{}).get("memory_mb",0)
print(f"    Memory before: {mem_before_val:.1f} MB")

# Inject memory leak
print(f"    Injecting memory leak (10MB x 20 steps)...", flush=True)
if HAS_NODE:
    mem_script = (
        "const chunks=[];"
        "let n=0;"
        "const iv=setInterval(()=>{"
        "  if(n>=20){clearInterval(iv);}"
        "  else{chunks.push(Buffer.alloc(10*1024*1024,0));n++;}"
        "},2000);"
    )
    mem_proc = subprocess.Popen(
        ["docker","exec",APP,"node","-e", mem_script],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
else:
    run("dd if=/dev/zero of=/tmp/memfile bs=10M count=20 2>/dev/null &", background=True)

# Collect 8 readings during fault (fault window)
print(f"    [fault   ] 80s poll...", flush=True)
tsd_detected_mem, mem_readings, mem_fault_flags = poll_tsd_mem(8)
mem_after_val = mem_readings[-1] if mem_readings else 0
mem_growth    = mem_after_val - mem_before_val

# Clean up and settle
kill_bg("Buffer.alloc")
kill_bg("memfile")
run("rm -f /tmp/memfile 2>/dev/null || true")
print(f"    [settle  ] 20s for memory to stabilize...", flush=True)
time.sleep(20)

# Collect 6 baseline readings (normal window) for TN/FP
print(f"    [baseline] 60s poll (no injection)...", flush=True)
_, mem_normal, mem_normal_flags = poll_tsd_mem(6)
mem_normal_after = mem_normal[-1] if mem_normal else 0.0

TP_mem = sum(1 for f in mem_fault_flags  if f)
FN_mem = sum(1 for f in mem_fault_flags  if not f)
TN_mem = sum(1 for f in mem_normal_flags if not f)
FP_mem = sum(1 for f in mem_normal_flags if f)
prec_mem, rec_mem, f1_mem, acc_mem = cm_metrics(TP_mem, FN_mem, TN_mem, FP_mem)

# ── 5. Build and save report ──────────────────────────────────
report = {
    "app":          APP,
    "evaluated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "app_type":     "production",

    "lsi_evaluation": {
        "total_lines_evaluated":   len(results),
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
        "classified_lines_sample": [
            {"ground_truth": gt, "predicted": pr, "correct": gt==pr}
            for gt, pr in results[:20]
        ],
    },

    "lsi_per_fault_type_evaluation": {
        "fault_types_tested":   ft_total,
        "fault_types_tp":       ft_detected_count,
        "aggregate_confusion":  {
            "TP": lsi_agg_TP, "FN": lsi_agg_FN, "TN": lsi_TN, "FP": lsi_FP,
            "precision": lsi_agg_prec, "recall": lsi_agg_rec,
            "f1": lsi_agg_f1, "accuracy": lsi_agg_acc,
        },
        "results": fault_type_results,
    },

    "tsd_cpu_evaluation": {
        "cpu_baseline_readings": [round(v,2) for v in cpu_before],
        "cpu_baseline_mean":     round(cpu_base_mean,2),
        "cpu_during_fault":      [round(v,2) for v in cpu_during],
        "cpu_fault_mean":        round(cpu_fault_mean,2),
        "cpu_normal_readings":   [round(v,2) for v in cpu_normal],
        "cpu_normal_mean":       round(cpu_normal_mean,2),
        "tsd_detected":          tsd_detected_cpu,
        "detection_cycles":      cpu_detect_cycles,
        "confusion_matrix":      {"TP": TP_cpu, "FN": FN_cpu, "TN": TN_cpu, "FP": FP_cpu},
        "precision":             prec_cpu,
        "recall":                rec_cpu,
        "f1":                    f1_cpu,
        "accuracy":              acc_cpu,
    },

    "tsd_memory_evaluation": {
        "memory_before_mb":      round(mem_before_val,2),
        "memory_after_mb":       round(mem_after_val,2),
        "memory_growth_mb":      round(mem_growth,2),
        "memory_readings":       [round(v,2) for v in mem_readings],
        "memory_normal_readings": [round(v,2) for v in mem_normal],
        "memory_normal_after_mb": round(mem_normal_after,2),
        "tsd_detected":          tsd_detected_mem,
        "confusion_matrix":      {"TP": TP_mem, "FN": FN_mem, "TN": TN_mem, "FP": FP_mem},
        "precision":             prec_mem,
        "recall":                rec_mem,
        "f1":                    f1_mem,
        "accuracy":              acc_mem,
    },
}

with open(OUTPUT, "w") as f:
    json.dump(report, f, indent=2)

# ── Print results ─────────────────────────────────────────────
print(f"\n{SEP}")
print(f"  PRODUCTION EVALUATION RESULTS — {APP}")
print(SEP)

print(f"\n  ┌─ LSI LOG CLASSIFICATION ──────────────────────────────────────────")
print(f"  │  Lines evaluated       : {len(results)}")
print(f"  │  ERROR lines (injected): {err_inj}  (ground truth = ERROR)")
print(f"  │  INFO  lines (baseline): {info_cnt}  (ground truth = INFO)")
print(f"  │  Anomaly detected      : {lsi_detected}")
print(f"  │  LSI score             : {lsi_after.get('current_score',0):.4f}")
print(f"  │  Baseline mean         : {lsi_after.get('baseline_mean',0):.4f}")
print(f"  │  Threshold             : {lsi_after.get('threshold',0):.4f}")
print(f"  │")
print(f"  │  {'Class':<8} {'Precision':>10} {'Recall':>8} {'F1':>8} {'Accuracy':>10} {'TP':>5} {'FP':>5} {'FN':>5} {'TN':>5}")
print(f"  │  {'─'*66}")
for cls in classes:
    m = metrics[cls]
    print(f"  │  {cls:<8} {m['precision']:>10.4f} {m['recall']:>8.4f} {m['f1']:>8.4f} {m['accuracy']:>10.4f} {m['TP']:>5} {m['FP']:>5} {m['FN']:>5} {m['TN']:>5}")
print(f"  │  {'─'*66}")
print(f"  │  {'MACRO':<8} {macro_p:>10.4f} {macro_r:>8.4f} {macro_f1:>8.4f} {overall_acc:>10.4f}")
print(f"  └────────────────────────────────────────────────────────────────────")

print(f"\n  ┌─ LSI PER-FAULT TYPE — AGGREGATE ───────────────────────────────────")
print(f"  │  Fault types tested : {ft_total}   Detected : {ft_detected_count}/{ft_total}")
print(f"  │  Aggregate — TP : {lsi_agg_TP}   FP : {lsi_FP}   FN : {lsi_agg_FN}   TN : {lsi_TN}")
print(f"  │  Aggregate — Precision : {lsi_agg_prec:.4f}   Recall : {lsi_agg_rec:.4f}   F1 : {lsi_agg_f1:.4f}")
print(f"  └────────────────────────────────────────────────────────────────────")
for ft_name, ft_res in fault_type_results.items():
    print(f"\n  ┌─ LSI [{ft_name}] {'─'*max(1,52-len(ft_name))}")
    print(f"  │  Fault peak error_score  : {ft_res['fault_peak_error_score']:.4f}")
    print(f"  │  Normal peak error_score : {ft_res['normal_peak_error_score']:.4f}")
    print(f"  │  {'Class':<8} {'Precision':>10} {'Recall':>8} {'F1':>8} {'TP':>5} {'FP':>5} {'FN':>5} {'TN':>5}")
    print(f"  │  {'─'*58}")
    print(f"  │  {'Detect':<8} {ft_res['precision']:>10.4f} {ft_res['recall']:>8.4f} {ft_res['f1']:>8.4f}"
          f" {ft_res['TP']:>5} {ft_res['FP']:>5} {ft_res['FN']:>5} {ft_res['TN']:>5}")
    print(f"  └────────────────────────────────────────────────────────────────────")

print(f"\n  ┌─ TSD CPU SPIKE DETECTION ──────────────────────────────────────────")
print(f"  │  Pre-fault baseline (6 readings): {[round(v,1) for v in cpu_before]}")
print(f"  │  Pre-fault mean                 : {cpu_base_mean:.2f}%")
print(f"  │  Fault readings (6)             : {[round(v,1) for v in cpu_during]}")
print(f"  │  Fault mean                     : {cpu_fault_mean:.2f}%")
print(f"  │  Normal readings (5)            : {[round(v,1) for v in cpu_normal]}")
print(f"  │  TSD detected                   : {tsd_detected_cpu}")
print(f"  │  Detection cycles               : {cpu_detect_cycles}/6")
print(f"  │")
print(f"  │  {'Class':<8} {'Precision':>10} {'Recall':>8} {'F1':>8} {'TP':>5} {'FP':>5} {'FN':>5} {'TN':>5}")
print(f"  │  {'─'*58}")
print(f"  │  {'Detect':<8} {prec_cpu:>10.4f} {rec_cpu:>8.4f} {f1_cpu:>8.4f}"
      f" {TP_cpu:>5} {FP_cpu:>5} {FN_cpu:>5} {TN_cpu:>5}")
print(f"  └────────────────────────────────────────────────────────────────────")

print(f"\n  ┌─ TSD MEMORY LEAK DETECTION ────────────────────────────────────────")
pct = (mem_growth/mem_before_val*100) if mem_before_val>0 else 0
print(f"  │  Memory before         : {mem_before_val:.1f} MB")
print(f"  │  Memory after (fault)  : {mem_after_val:.1f} MB")
print(f"  │  Growth                : +{mem_growth:.1f} MB  (+{pct:.1f}%)")
print(f"  │  Fault readings (8)    : {[round(v,1) for v in mem_readings]}")
print(f"  │  Normal readings (6)   : {[round(v,1) for v in mem_normal]}")
print(f"  │  TSD detected          : {tsd_detected_mem}")
print(f"  │")
print(f"  │  {'Class':<8} {'Precision':>10} {'Recall':>8} {'F1':>8} {'TP':>5} {'FP':>5} {'FN':>5} {'TN':>5}")
print(f"  │  {'─'*58}")
print(f"  │  {'Detect':<8} {prec_mem:>10.4f} {rec_mem:>8.4f} {f1_mem:>8.4f}"
      f" {TP_mem:>5} {FP_mem:>5} {FN_mem:>5} {TN_mem:>5}")
print(f"  └────────────────────────────────────────────────────────────────────")

print(f"\n  Full JSON saved to: {OUTPUT}")
print(SEP)
PYEOF
