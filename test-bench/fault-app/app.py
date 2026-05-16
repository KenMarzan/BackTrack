"""
BackTrack Fault-Injection Test App
A controllable Flask app that simulates real faults on demand.
Endpoints:
  GET /          → health check (always 200)
  GET /status    → current fault state
  POST /fault/cpu-spike        → burn CPU for N seconds
  POST /fault/memory-leak      → allocate RAM in steps
  POST /fault/log-errors       → flood stdout with ERROR lines
  POST /fault/crash            → exit with code 1
  POST /reset                  → stop all active faults
"""
import os
import sys
import time
import threading
import logging
import random
import string
from flask import Flask, jsonify, request

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("fault-app")

app = Flask(__name__)
APP_NAME = os.getenv("APP_NAME", "fault-app")

# Fault state
_state = {
    "cpu_active": False,
    "memory_active": False,
    "log_errors_active": False,
    "memory_chunks": [],   # holds allocated bytes so GC doesn't free them
}
_threads = []


def _stop_all():
    _state["cpu_active"] = False
    _state["memory_active"] = False
    _state["log_errors_active"] = False
    _state["memory_chunks"].clear()
    log.info("[%s] All faults reset.", APP_NAME)


# ── Emit startup INFO logs so LSI builds a real corpus ─────────────────────
def _emit_startup_logs():
    messages = [
        "Starting %s service" % APP_NAME,
        "Database connection established",
        "Listening on port 5000",
        "Health check endpoint registered at /",
        "Configuration loaded successfully",
        "Worker pool initialized with 4 threads",
        "Cache warmed up: 1024 entries loaded",
        "Request routing configured",
        "Metrics collection started",
        "Service ready to accept requests",
    ]
    for msg in messages:
        log.info(msg)
        time.sleep(0.1)

    # Emit steady INFO logs every 5 seconds forever (so LSI has live data)
    def _steady_logs():
        steady = [
            "GET / 200 OK 1ms",
            "Health check passed",
            "Processed request successfully",
            "Cache hit ratio: 94%%",
            "Active connections: %d" % random.randint(10, 50),
            "Memory usage nominal",
            "Worker heartbeat OK",
        ]
        while True:
            log.info(random.choice(steady))
            time.sleep(5)

    t = threading.Thread(target=_steady_logs, daemon=True)
    t.start()


# ── Fault implementations ───────────────────────────────────────────────────

def _cpu_worker():
    log.warning("[%s] CPU spike started", APP_NAME)
    while _state["cpu_active"]:
        # Burn CPU with pointless computation
        _ = sum(i * i for i in range(100000))
    log.info("[%s] CPU spike ended", APP_NAME)


def _memory_worker(mb_per_step=10, steps=20, interval=2):
    log.warning("[%s] Memory leak started: allocating %dMB every %ds for %d steps",
                APP_NAME, mb_per_step, interval, steps)
    for i in range(steps):
        if not _state["memory_active"]:
            break
        chunk = b"x" * (mb_per_step * 1024 * 1024)
        _state["memory_chunks"].append(chunk)
        total = len(_state["memory_chunks"]) * mb_per_step
        log.warning("[%s] Memory allocated: %dMB total (step %d/%d)",
                    APP_NAME, total, i + 1, steps)
        time.sleep(interval)
    log.info("[%s] Memory leak phase complete", APP_NAME)


def _log_error_worker(count=200, interval=0.3):
    errors = [
        "NullPointerException in PaymentService.processPayment() at line 142",
        "Connection refused: database host postgres:5432 is unreachable",
        "Timeout after 5000ms waiting for upstream service response",
        "HTTP 500 Internal Server Error on POST /api/checkout",
        "Out of memory: failed to allocate 512MB for request buffer",
        "Deadlock detected in transaction manager, rolling back",
        "Fatal: uncaught exception in worker thread — restarting",
        "SSL certificate validation failed for api.payments.com",
        "Rate limit exceeded: 429 Too Many Requests from upstream",
        "Disk I/O error writing to /var/log/app.log: No space left",
    ]
    log.error("[%s] Starting error flood: %d lines", APP_NAME, count)
    for i in range(count):
        if not _state["log_errors_active"]:
            break
        msg = random.choice(errors)
        log.error("[%s] %s (occurrence %d)", APP_NAME, msg, i + 1)
        time.sleep(interval)
    _state["log_errors_active"] = False
    log.info("[%s] Error flood complete", APP_NAME)


# ── HTTP Endpoints ──────────────────────────────────────────────────────────

@app.get("/")
def health():
    return jsonify({"status": "ok", "app": APP_NAME, "faults": {
        "cpu": _state["cpu_active"],
        "memory": _state["memory_active"],
        "log_errors": _state["log_errors_active"],
        "memory_mb_allocated": len(_state["memory_chunks"]) * 10,
    }})


@app.get("/status")
def status():
    return jsonify(_state | {"app": APP_NAME})


@app.post("/fault/cpu-spike")
def fault_cpu():
    if _state["cpu_active"]:
        return jsonify({"ok": False, "message": "CPU spike already active"})
    _state["cpu_active"] = True
    n_workers = int(request.json.get("workers", 2)) if request.is_json else 2
    for _ in range(n_workers):
        t = threading.Thread(target=_cpu_worker, daemon=True)
        t.start()
    log.warning("[%s] CPU spike triggered: %d workers", APP_NAME, n_workers)
    return jsonify({"ok": True, "workers": n_workers})


@app.post("/fault/memory-leak")
def fault_memory():
    if _state["memory_active"]:
        return jsonify({"ok": False, "message": "Memory leak already active"})
    _state["memory_active"] = True
    t = threading.Thread(target=_memory_worker, daemon=True)
    t.start()
    log.warning("[%s] Memory leak triggered", APP_NAME)
    return jsonify({"ok": True})


@app.post("/fault/log-errors")
def fault_log_errors():
    _state["log_errors_active"] = True
    count = int(request.json.get("count", 200)) if request.is_json else 200
    t = threading.Thread(target=_log_error_worker, args=(count,), daemon=True)
    t.start()
    log.warning("[%s] Error log flood triggered: %d lines", APP_NAME, count)
    return jsonify({"ok": True, "count": count})


@app.post("/fault/crash")
def fault_crash():
    log.error("[%s] FATAL: crash triggered via /fault/crash endpoint", APP_NAME)
    time.sleep(0.5)
    os._exit(1)


@app.post("/reset")
def reset():
    _stop_all()
    return jsonify({"ok": True, "message": "All faults cleared"})


if __name__ == "__main__":
    _emit_startup_logs()
    port = int(os.getenv("PORT", 5000))
    log.info("[%s] Listening on port %d", APP_NAME, port)
    app.run(host="0.0.0.0", port=port, threaded=True)
