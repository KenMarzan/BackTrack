#!/usr/bin/env bash
# ============================================================
# Results Collector — dumps TSD + LSI state for all 10 apps
# into a JSON file for thesis data analysis.
# Usage: ./collect_results.sh [output_file.json]
# ============================================================

AGENT_URL="http://localhost:8847"
OUTPUT=${1:-"results_$(date +%Y%m%d_%H%M%S).json"}

APPS=(
  app-fault-1
  app-fault-2
  app-fault-3
  app-fault-4
  app-fault-5
  app-nginx
  app-grafana
  app-prometheus
  app-rabbitmq
  app-redis
)

echo "Collecting results from BackTrack agent..."
echo "Output file: $OUTPUT"
echo ""

python3 - <<PYEOF
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

AGENT_URL = "$AGENT_URL"
APPS = $(printf '"%s",' "${APPS[@]}" | sed 's/,$//' | python3 -c "import sys; print('[' + sys.stdin.read() + ']')")
OUTPUT = "$OUTPUT"

results = {
    "collected_at": datetime.now(timezone.utc).isoformat(),
    "agent_url": AGENT_URL,
    "services": {}
}

def fetch(path):
    try:
        with urllib.request.urlopen(f"{AGENT_URL}{path}", timeout=5) as r:
            return json.load(r)
    except Exception as e:
        return {"error": str(e)}

for app in APPS:
    print(f"  Collecting {app}...")
    tsd = fetch(f"/metrics?service={app}")
    lsi = fetch(f"/lsi?service={app}")

    results["services"][app] = {
        "tsd": {
            "readings_count":   tsd.get("readings_count", 0),
            "is_drifting":      tsd.get("is_drifting", None),
            "has_crashed":      tsd.get("has_crashed", None),
            "tsd_confidence":   tsd.get("tsd_confidence", 0),
            "tsd_status":       tsd.get("tsd_status", {}),
            "z_scores":         tsd.get("z_scores", {}),
            "trend_directions": tsd.get("trend_directions", {}),
            "current":          tsd.get("current", {}),
            "evaluation":       tsd.get("evaluation", {}),
        },
        "lsi": {
            "fitted":               lsi.get("fitted", False),
            "corpus_size":          lsi.get("corpus_size", 0),
            "is_anomalous":         lsi.get("is_anomalous", None),
            "is_error_anomalous":   lsi.get("is_error_anomalous", None),
            "current_score":        lsi.get("current_score", 0),
            "baseline_mean":        lsi.get("baseline_mean", 0),
            "threshold":            lsi.get("threshold", 0),
            "error_score":          lsi.get("error_score", 0),
            "error_threshold":      lsi.get("error_threshold", 0),
            "log_diversity":        lsi.get("log_diversity", ""),
            "dominant_themes":      lsi.get("dominant_themes", []),
            "error_patterns":       lsi.get("error_patterns", []),
            "evaluation":           lsi.get("evaluation", {}),
        }
    }

with open(OUTPUT, "w") as f:
    json.dump(results, f, indent=2)

print(f"\nSaved to {OUTPUT}")
print("\n=== SUMMARY ===")
print(f"{'App':<20} {'Readings':>8} {'TSD Drift':>10} {'LSI Anom':>10} {'Confidence':>12}")
print("-" * 65)
for app, data in results["services"].items():
    t = data["tsd"]
    l = data["lsi"]
    print(f"{app:<20} {t['readings_count']:>8} {str(t['is_drifting']):>10} {str(l['is_error_anomalous']):>10} {t['tsd_confidence']:>12.3f}")
PYEOF
