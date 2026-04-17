# BackTrack Setup Guide

Add BackTrack to any containerized application to get automatic anomaly detection and rollback. No code changes required — BackTrack runs as a sidecar container alongside your app.

---

## What You Need

- **Docker 24+** with Docker Compose v2
- A containerized app (any language/framework)
- ~5 minutes

---

## Step 1: Clone BackTrack

```bash
git clone https://github.com/KenMarzan/BackTrack.git
cd BackTrack
```

---

## Step 2: Build the Agent

```bash
cd backtrack-agent
docker build -t backtrack-agent:latest .
cd ..
```

This builds the Python sidecar that runs TSD and LSI analysis.

---

## Step 3: Add BackTrack to Your Docker Compose

Add the `backtrack` service to your existing `docker-compose.yml`:

```yaml
services:
  # Your existing app (example)
  my-app:
    image: my-app:latest
    ports:
      - "8080:8080"

  # Add this block
  backtrack:
    image: backtrack-agent:latest
    environment:
      - BACKTRACK_TARGET=my-app          # Must match your app service name above
      - BACKTRACK_IMAGE_TAG=v1.0.0       # Current version tag (set from CI or manually)
      - BACKTRACK_ROLLBACK_ENABLED=true
      - BACKTRACK_SCRAPE_INTERVAL=10
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock   # Required: Docker socket access
      - backtrack-data:/data                         # Persists version snapshots
    ports:
      - "9090:9090"                                  # Agent API
    depends_on:
      - my-app

volumes:
  backtrack-data:
```

**Important:** Replace `my-app` with your actual service name. The `BACKTRACK_TARGET` value must exactly match the service name in your compose file.

Or copy the ready-made template:

```bash
cp backtrack-agent/docker-compose.with-backtrack.yml your-project/docker-compose.backtrack.yml
```

---

## Step 4: Start Everything

```bash
docker compose up -d
```

Verify the agent is running:

```bash
curl http://localhost:9090/health
```

Expected response:

```json
{
  "status": "ok",
  "mode": "docker",
  "uptime_seconds": 5.2
}
```

---

## Step 5: Start the Dashboard

In the BackTrack repo directory:

```bash
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

Set the `BACKTRACK_AGENT_URL` environment variable if the agent is not on localhost:

```bash
BACKTRACK_AGENT_URL=http://your-host:9090 npm run dev
```

---

## What Happens Next

### Warm-up Phase (~2-10 minutes)

BackTrack needs time to build baselines before it can detect anomalies:

| Component | Warm-up | What It Does |
|-----------|---------|-------------|
| **TSD** | 12 readings (~2 min) | Collects CPU, memory, latency, error rate. Runs STL decomposition once 12 data points exist. |
| **LSI** | 200 log lines (varies) | Tails your container logs. Fits TF-IDF + SVD model after 200 lines. Starts classifying logs as INFO/WARN/ERROR/NOVEL. |
| **Version Store** | 10 min clean | After 10 minutes without anomalies, marks the current version as STABLE. This is the rollback target. |

### Monitoring Phase

Once baselines are established:

- **TSD** runs STL decomposition every scrape interval (default 10s). Flags drift when residuals exceed 3x IQR for 3 consecutive readings.
- **LSI** scores every 30-second log window. Flags anomaly when score exceeds 2x baseline mean.
- **Rollback** triggers automatically when both TSD AND LSI flag anomalies for 3 consecutive cycles.

---

## Dashboard Pages

### Main Dashboard (`/`)

- **Container Health** — live CPU, memory, request rate charts
- **Recent Deployment** — version history with rollback buttons
- **Anomaly Detection** — active anomalies with severity badges (click to drill down)
- **Active Containers** — all discovered services and their status

### Anomalies Page (`/anomalies`)

- **Terminal** — interactive kubectl/command terminal
- **TSD Metrics** — live CPU, memory, latency, error rate from agent
- **LSI Analysis** — current score, threshold, score history chart

### Service Diagnostics (`/anomalies/{service}`)

Click any anomaly from the main dashboard to see:

- **TSD Panel** — current metrics, STL residuals, residual bar charts, drift status
- **LSI Panel** — score vs threshold, log classification counts (INFO/WARN/ERROR/NOVEL), score history
- **Classified Log Stream** — live log feed with per-line classification labels
- **Version Comparison** — current version vs last stable
- **Agent Status** — drift/anomaly/model state at a glance

---

## Agent API Endpoints

All available at `http://localhost:9090`:

| Endpoint | Method | Returns |
|----------|--------|---------|
| `/health` | GET | Agent status, mode, uptime |
| `/config` | GET | All configuration values |
| `/metrics` | GET | TSD: current readings, history, residuals, drift status |
| `/lsi` | GET | LSI: score, threshold, window counts, classified recent lines |
| `/versions` | GET | Version snapshots (PENDING / STABLE / ROLLED_BACK) |
| `/rollback/history` | GET | Past rollback events with timestamps |
| `/rollback/trigger` | POST | Manually trigger rollback to last stable version |

### Example: Check TSD Status

```bash
curl http://localhost:9090/metrics | python3 -m json.tool
```

```json
{
  "current": {
    "cpu_percent": 12.5,
    "memory_mb": 84.2,
    "latency_ms": 23.0,
    "error_rate_percent": 0.0
  },
  "history": {
    "cpu": [10.2, 11.1, 12.5],
    "memory": [82.0, 83.5, 84.2]
  },
  "residuals": {
    "cpu": [0.12, -0.05, 0.08],
    "memory": [0.5, -0.2, 0.3]
  },
  "readings_count": 18,
  "is_drifting": false
}
```

### Example: Check LSI Status

```bash
curl http://localhost:9090/lsi | python3 -m json.tool
```

```json
{
  "fitted": true,
  "corpus_size": 200,
  "current_score": 0.1234,
  "baseline_mean": 0.0812,
  "threshold": 0.1624,
  "is_anomalous": false,
  "window_counts": { "INFO": 15, "WARN": 2, "ERROR": 0, "NOVEL": 0 },
  "score_history": [0.08, 0.09, 0.07, 0.12],
  "recent_lines": [
    { "line": "[INFO] Request handled in 23ms", "label": "INFO", "timestamp": 1713400000 }
  ]
}
```

---

## Configuration Reference

Set these as environment variables on the `backtrack` container:

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKTRACK_TARGET` | *(required)* | Docker container/service name to monitor |
| `BACKTRACK_IMAGE_TAG` | `unknown` | Current deployed version tag |
| `BACKTRACK_K8S_NAMESPACE` | `default` | Kubernetes namespace (K8s mode only) |
| `BACKTRACK_K8S_LABEL_SELECTOR` | *(empty)* | K8s pod selector, e.g. `app=myapp` |
| `BACKTRACK_SCRAPE_INTERVAL` | `10` | Seconds between metric scrapes |
| `BACKTRACK_TSD_IQR_MULTIPLIER` | `3.0` | TSD sensitivity — lower = more sensitive |
| `BACKTRACK_LSI_SCORE_MULTIPLIER` | `2.0` | LSI sensitivity — lower = more sensitive |
| `BACKTRACK_ROLLBACK_ENABLED` | `true` | Set `false` to monitor without auto-rollback |

---

## Running the Automated Test

BackTrack includes a test harness that injects a known-bad container and measures detection/rollback time.

### Prerequisites

```bash
pip install docker requests
```

### Run the Test

```bash
# Make sure your app + backtrack are running first
# Wait ~10 minutes for backtrack to mark the version as STABLE

python tests/inject_failure.py \
  --target my-app \
  --agent-url http://localhost:9090 \
  --app-name "My App" \
  --output tests/results_myapp.json
```

### What the Test Does

1. Checks agent health
2. Verifies a STABLE version snapshot exists
3. Builds a "bad" container (logs ERRORs, returns 503, 5s latency)
4. Replaces your app container with the bad one
5. Polls TSD + LSI every 5 seconds
6. Records when anomaly is detected
7. Records when rollback completes
8. Writes results to JSON
9. Prints summary:

```
═══════════════════════════════════════════════════
  BACKTRACK BENCHMARK RESULTS
═══════════════════════════════════════════════════
  App:                  My App
  Detection time:       45.0s  ✓ (target < 5 min)
  Rollback time:        12.3s  ✓ (target < 2 min)
  Total time:           57.3s
  False positives:      0
═══════════════════════════════════════════════════
```

---

## Kubernetes Setup

For Kubernetes instead of Docker:

```yaml
# Add as a sidecar container in your Deployment spec
containers:
  - name: my-app
    image: my-app:v1.0.0
    ports:
      - containerPort: 8080

  - name: backtrack
    image: backtrack-agent:latest
    env:
      - name: BACKTRACK_K8S_NAMESPACE
        value: "default"
      - name: BACKTRACK_K8S_LABEL_SELECTOR
        value: "app=my-app"
      - name: BACKTRACK_IMAGE_TAG
        value: "v1.0.0"
      - name: BACKTRACK_ROLLBACK_ENABLED
        value: "true"
    ports:
      - containerPort: 9090
    volumeMounts:
      - name: backtrack-data
        mountPath: /data

volumes:
  - name: backtrack-data
    emptyDir: {}
```

Verify:

```bash
kubectl port-forward deploy/my-app 9090:9090
curl http://localhost:9090/health
```

Then connect via the dashboard's Configure Cluster modal.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Agent won't start | Check Docker socket mount: `-v /var/run/docker.sock:/var/run/docker.sock` |
| No metrics data | Verify `BACKTRACK_TARGET` matches `docker ps` container name exactly |
| LSI stuck on "Training" | Your app needs to produce 200+ log lines. Check `curl :9090/lsi` for `corpus_size` |
| Too many false positives | Increase `BACKTRACK_TSD_IQR_MULTIPLIER` to 4.0 or 5.0 |
| Rollback not triggering | Needs a STABLE snapshot first (10 min clean). Check `curl :9090/versions` |
| Dashboard shows "Agent Offline" | Set `BACKTRACK_AGENT_URL=http://host:9090` env var when running dashboard |
| Dashboard not loading | Run `npm install && npm run dev` in BackTrack repo root |

---

## Quick Start Checklist

- [ ] Build agent: `docker build -t backtrack-agent:latest backtrack-agent/`
- [ ] Add `backtrack` service to your docker-compose.yml
- [ ] Set `BACKTRACK_TARGET` to your app service name
- [ ] Set `BACKTRACK_IMAGE_TAG` to current version
- [ ] Run `docker compose up -d`
- [ ] Verify: `curl http://localhost:9090/health`
- [ ] Start dashboard: `npm run dev`
- [ ] Open http://localhost:3000
- [ ] Wait ~2 min for TSD warm-up, ~10 min for STABLE version
- [ ] Check `/anomalies` page for live TSD/LSI panels
