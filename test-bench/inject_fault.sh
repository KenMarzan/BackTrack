#!/usr/bin/env bash
# ============================================================
# Fault Injection Script for BackTrack Test Bench
# Usage: ./inject_fault.sh <app-name> <fault-type>
#
# Fault types:
#   cpu-spike       — burn CPU via HTTP endpoint
#   memory-leak     — allocate real RAM via HTTP endpoint
#   log-errors      — flood stdout with ERROR lines via HTTP endpoint
#   crash           — kill the container process (triggers restart)
#   stop            — stop container (tests flat-zero detection)
#   reset           — clear all active faults
#
# Works reliably on app-fault-1 through app-fault-5.
# For app-nginx, app-grafana etc. only crash/stop work.
#
# Examples:
#   ./inject_fault.sh app-fault-1 cpu-spike
#   ./inject_fault.sh app-fault-2 log-errors
#   ./inject_fault.sh app-fault-3 memory-leak
#   ./inject_fault.sh app-fault-4 crash
# ============================================================

APP=$1
FAULT=$2
AGENT_URL="http://localhost:8847"

# Port map: container name → host port of the fault-app HTTP server
declare -A PORT_MAP=(
  ["app-fault-1"]="8101"
  ["app-fault-2"]="8102"
  ["app-fault-3"]="8103"
  ["app-fault-4"]="8104"
  ["app-fault-5"]="8105"
)

if [[ -z "$APP" || -z "$FAULT" ]]; then
  echo "Usage: $0 <app-name> <fault-type>"
  echo "  fault types: cpu-spike | memory-leak | log-errors | crash | stop | reset"
  echo "  controllable apps: app-fault-1 .. app-fault-5"
  exit 1
fi

APP_PORT="${PORT_MAP[$APP]}"
APP_URL="http://localhost:${APP_PORT}"

echo ""
echo "============================================="
echo "  INJECTING FAULT: $FAULT → $APP"
echo "  App URL: $APP_URL"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================="

INJECT_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

poll_detection() {
  echo ""
  echo "Polling BackTrack every 10s for up to 3 minutes..."
  DETECTED=false
  for i in $(seq 1 18); do
    sleep 10
    ELAPSED=$((i * 10))

    TSD=$(curl -s "$AGENT_URL/metrics?service=$APP" | python3 -c \
      "import sys,json; d=json.load(sys.stdin); print(d.get('is_drifting','?'))" 2>/dev/null)
    LSI=$(curl -s "$AGENT_URL/lsi?service=$APP" | python3 -c \
      "import sys,json; d=json.load(sys.stdin); print(d.get('is_error_anomalous','?'))" 2>/dev/null)
    CRASH=$(curl -s "$AGENT_URL/metrics?service=$APP" | python3 -c \
      "import sys,json; d=json.load(sys.stdin); print(d.get('has_crashed','?'))" 2>/dev/null)

    echo "  [${ELAPSED}s] TSD=${TSD}  LSI=${LSI}  Crash=${CRASH}"

    if [[ "$TSD" == "True" || "$LSI" == "True" || "$CRASH" == "True" ]]; then
      echo ""
      echo "  ✓ DETECTED at ${ELAPSED}s after injection"
      echo "    Detection latency: ${ELAPSED} seconds"
      DETECTED=true
      break
    fi
  done

  if [[ "$DETECTED" == "false" ]]; then
    echo ""
    echo "  ✗ NOT DETECTED within 180s"
  fi
}

run_analysis() {
  echo ""
  echo "Running full analysis (logs + classifications + metrics)..."
  bash "$(dirname "$0")/analyze_results.sh" "$APP-$FAULT"
}

show_snapshot() {
  echo ""
  echo "--- TSD snapshot ---"
  curl -s "$AGENT_URL/metrics?service=$APP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('  readings:  ', d.get('readings_count'))
print('  drifting:  ', d.get('is_drifting'))
print('  crashed:   ', d.get('has_crashed'))
print('  tsd_status:', d.get('tsd_status'))
print('  z_scores:  ', d.get('z_scores'))
mem = d.get('history', {}).get('memory', [])
print('  mem last5: ', mem[-5:] if mem else [])
cpu = d.get('history', {}).get('cpu', [])
print('  cpu last5: ', cpu[-5:] if cpu else [])
" 2>/dev/null

  echo ""
  echo "--- LSI snapshot ---"
  curl -s "$AGENT_URL/lsi?service=$APP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('  fitted:       ', d.get('fitted'))
print('  corpus:       ', d.get('corpus_size'))
print('  score:        ', d.get('current_score'))
print('  baseline_mean:', d.get('baseline_mean'))
print('  error_score:  ', d.get('error_score'))
print('  is_anomalous: ', d.get('is_error_anomalous'))
print('  diversity:    ', d.get('log_diversity'))
" 2>/dev/null
}

# ── Fault dispatch ──────────────────────────────────────────────────────────

case "$FAULT" in

  cpu-spike)
    if [[ -z "$APP_PORT" ]]; then
      echo "ERROR: $APP is not a controllable fault-app."
      echo "Only app-fault-1 through app-fault-5 support cpu-spike via HTTP."
      exit 1
    fi
    echo "Triggering CPU spike via $APP_URL/fault/cpu-spike ..."
    RESP=$(curl -s -X POST "$APP_URL/fault/cpu-spike" \
      -H "Content-Type: application/json" \
      -d '{"workers": 4}')
    echo "Response: $RESP"
    poll_detection
    show_snapshot
    run_analysis
    ;;

  memory-leak)
    if [[ -z "$APP_PORT" ]]; then
      echo "ERROR: $APP is not a controllable fault-app."
      exit 1
    fi
    echo "Triggering memory leak via $APP_URL/fault/memory-leak ..."
    RESP=$(curl -s -X POST "$APP_URL/fault/memory-leak" \
      -H "Content-Type: application/json")
    echo "Response: $RESP"
    poll_detection
    show_snapshot
    ;;

  log-errors)
    if [[ -z "$APP_PORT" ]]; then
      echo "ERROR: $APP is not a controllable fault-app."
      exit 1
    fi
    echo "Triggering error log flood via $APP_URL/fault/log-errors ..."
    RESP=$(curl -s -X POST "$APP_URL/fault/log-errors" \
      -H "Content-Type: application/json" \
      -d '{"count": 200}')
    echo "Response: $RESP"
    echo "Verifying logs reach docker ..."
    sleep 3
    COUNT=$(docker logs "$APP" 2>&1 | grep -c "NullPointerException\|Connection refused to database\|Out of memory\|Deadlock" || echo 0)
    echo "  ERROR lines in docker logs: $COUNT"
    poll_detection
    show_snapshot
    ;;

  crash)
    if [[ -n "$APP_PORT" ]]; then
      echo "Triggering crash via $APP_URL/fault/crash ..."
      curl -s -X POST "$APP_URL/fault/crash" || true
    else
      echo "Killing container $APP ..."
      docker kill --signal=SIGKILL "$APP"
    fi
    poll_detection
    show_snapshot
    ;;

  stop)
    echo "Stopping container $APP ..."
    docker stop "$APP"
    poll_detection
    show_snapshot
    echo "Restarting $APP ..."
    docker start "$APP"
    ;;

  reset)
    if [[ -z "$APP_PORT" ]]; then
      echo "ERROR: $APP is not a controllable fault-app."
      exit 1
    fi
    echo "Resetting all faults on $APP ..."
    RESP=$(curl -s -X POST "$APP_URL/reset")
    echo "Response: $RESP"
    ;;

  *)
    echo "Unknown fault: $FAULT"
    echo "Valid: cpu-spike | memory-leak | log-errors | crash | stop | reset"
    exit 1
    ;;
esac
