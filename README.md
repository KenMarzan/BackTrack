# BackTrack

> **Local-first observability, anomaly detection, and autonomous self-healing rollback for Kubernetes and Docker workloads.**

BackTrack watches your containerized services in real time, detects metric drift and log anomalies using two independent ML algorithms (TSD and LSI), and automatically rolls back to the last stable version when thresholds are breached — no cloud dependency, no SaaS, no agent phone-home.

---

## Screenshots

### Dashboard — Live Telemetry
![Anomaly Detection panel showing all systems nominal](docs/screenshots/anomaly-detection-nominal.png)
> Main dashboard. Container Health chart, Recent Deployments, Anomaly Detection panel (Critical · High · Medium counters), and Active Containers table.

### Anomalies — TSD + LSI Live Panels
![Anomalies page with TSD and LSI panels](docs/screenshots/anomalies-tsd-lsi.png)
> Anomalies page with the agent online. Left: interactive kubectl terminal. Right: TSD Metrics and LSI Analysis.

### Anomalies — Full Live View
![Anomalies page live view](docs/screenshots/anomalies-page.png)
> Full anomalies page. TSD metrics update every 10 s. LSI score history chart fills as the corpus grows.

### Service Diagnostics — Per-Service Drill-Down
![Service diagnostics page](docs/screenshots/service-diagnostics.png)
> Drill-down per service. TSD/LSI panels, classified log stream, root cause analysis, rollback action.

---

## What It Does

| Capability | Description |
|---|---|
| **Service Discovery** | Auto-discovers all pods/containers via `kubectl get deployments` or `docker ps` |
| **Per-Service Monitoring** | Individual TSD + LSI collectors per service — click any service to see its own metrics |
| **Live Metrics** | Polls Prometheus for CPU, memory, request rate — falls back to `kubectl top` |
| **TSD — Time Series Decomposition** | STL decomposition into Seasonal · Trend · Residual; flags drift when residuals exceed 3×IQR for 3 consecutive readings |
| **LSI — Latent Semantic Indexing** | TF-IDF + SVD on live log lines; classifies each line as INFO/WARN/ERROR/NOVEL; triggers when score exceeds baseline threshold |
| **Confusion Matrix** | Live precision, recall, F1, accuracy for both TSD and LSI — auto-populated from agent data |
| **Auto-Rollback** | After 3 consecutive anomaly cycles (~90 s), rolls back the deployment to the last STABLE snapshot |
| **Replica Restore** | Rollback automatically restores replicas if deployment was scaled to 0 |
| **NodePort Exposure** | After rollback, creates/patches a NodePort service so the app is immediately accessible |
| **Kubectl Terminal** | Interactive terminal embedded in the Anomalies page |
| **Rollback History** | Full audit trail with MTTR tracking |
| **MTTR Dashboard** | Mean Time to Recovery stats across all rollback events |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    BackTrack Dashboard                   │
│              Next.js 16 · React 19 · TypeScript          │
│                                                          │
│  /               → Dashboard (health, metrics, anomalies)│
│  /anomalies      → Terminal + TSD/LSI live panels        │
│  /anomalies/[s]  → Per-service diagnostics + rollback    │
│  /metrics        → MTTR + Confusion Matrix               │
└───────────────┬─────────────────┬────────────────────────┘
                │                 │
          kubectl/docker     HTTP :9090
                │                 │
    ┌───────────▼────┐   ┌────────▼───────────────┐
    │  Your Cluster  │   │   backtrack-agent       │
    │  or Docker     │   │   Python · FastAPI      │
    │  runtime       │   │                         │
    └────────────────┘   │  TSD collector (per svc)│
                         │  LSI log analyser (per) │
                         │  Version snapshotter    │
                         │  Rollback executor      │
                         └─────────────────────────┘
```

---

## Compatibility

| Your app is running as… | Supported? |
|---|---|
| Docker container | ✅ Yes |
| Kubernetes pod / deployment | ✅ Yes |
| Bare process / systemd / VM | ❌ Containerize it first |
| Serverless (Lambda, Cloud Run) | ❌ Out of scope |


---

## Getting Started

**→ [Full Setup Guide](docs/SETUP.md)**

Covers Docker Hub quickstart, Kubernetes mode, Docker mode, from-source setup, configuration reference, Prometheus integration, and troubleshooting.

**Shortest path:**

```bash
mkdir backtrack && cd backtrack
curl -O https://raw.githubusercontent.com/KenMarzan/BackTrack/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/KenMarzan/BackTrack/main/.env.example
docker compose up -d
```

Open **http://localhost:3000** → click **Configure Cluster** → connect your app.

---


## How TSD Works

BackTrack collects CPU, memory, latency, and error rate every 10 seconds. Once 12 readings are available:

1. **STL decomposition** splits each series into **Seasonal** + **Trend** + **Residual**
2. **IQR envelope** computes 3×IQR on historical residuals as the drift boundary
3. **Drift flag** raised when the last 3 consecutive residuals all exceed 3×IQR

### Anomaly Detection Timing

| Milestone | Time after agent start |
|---|---|
| TSD begins collecting | Immediately |
| TSD ready for drift detection | ~2 min (12 readings × 10 s) |
| LSI corpus filled | ~3 min (200 log lines) |
| LSI baseline locked | ~5 min (10 windows × 30 s) |
| Version marked STABLE | 10 min clean operation |
| Auto-rollback triggers | 3 anomaly cycles (~90 s) |

---

## How LSI Works

BackTrack tails logs from each container/pod and processes them in 30-second windows:

1. **Corpus collection** — first 200 log lines build the training set
2. **TF-IDF vectorisation** of each line
3. **SVD** reduces to a latent semantic space; centroids built per class (INFO/WARN/ERROR)
4. **Keyword pre-check** — lines with error/warn keywords fast-pathed before SVD
5. **SVD classification** — cosine similarity > 0.55 threshold required (configurable)
6. **Anomaly score** = weighted window entropy (`ERROR×3 + NOVEL×5 + WARN×1`) / total

---

## Detection Accuracy — Confusion Matrix

The `/metrics` page shows a live confusion matrix auto-populated from agent data:

**TSD** — compares sustained drifts (TP) vs spike drifts that resolve quickly (FP).

**LSI** — compares keyword-based classification (ground truth) vs SVD classification (predicted) across ERROR and NOVEL classes.

Precision, recall, F1, and accuracy update in real time as the agent accumulates data. Manual test runs can be added via **Add Test Run** for ground-truth validation.

---

## Rollback Flow

**Manual** (Dashboard → Recent Deployments → Rollback button):
1. BackTrack checks replica count — if 0, scales to 1 first
2. Executes `kubectl rollout undo deployment/<name>`
3. Waits for rollout to complete
4. Creates/patches a NodePort service so the app is immediately accessible
5. Returns the access URL in the success notification

**Automatic** (agent-triggered):
1. Agent detects 3 consecutive cycles where TSD drifting **or** LSI anomalous
2. Executes rollback + replica restore
3. 120 s cooldown prevents rollback loop

---

## Pages

### Dashboard (`/`)
- **Container Health** — per-service CPU/memory charts, running/down/unknown status
- **Recent Deployments** — K8s rollout history, BackTrack version snapshots, one-click rollback
- **Anomaly Detection** — live anomaly list with severity chips, auto-rollback badge
- **Active Containers** — table of all discovered services

### Anomalies (`/anomalies`)
- **Terminal** — interactive kubectl terminal
- **TSD Metrics** — CPU/Memory/Latency/Error Rate with Season · Trend · Residual sparklines
- **LSI Analysis** — score vs threshold, score history chart, classified log lines

### Service Diagnostics (`/anomalies/[service]`)
- Per-service TSD + LSI panels, classified log stream, root cause analysis, rollback action

### Evaluation Metrics (`/metrics`)
- **MTTR** — Mean Time to Recovery across all rollback events
- **Confusion Matrix** — live TSD + LSI precision/recall/F1/accuracy

---

## Troubleshooting

**Dashboard shows no services**
```bash
kubectl get pods -n default          # Verify pods are running
docker ps                            # Verify containers are up
```

**Agent offline**
```bash
curl http://127.0.0.1:9090/health    # Should return {"status":"ok"}
curl http://127.0.0.1:9090/services  # List monitored services
```

**All metrics are zero**
- Check for port conflict: `ss -tlnp | grep 9090` — if `kubectl port-forward` is also on 9090, it intercepts requests. Use `http://127.0.0.1:9090` explicitly or kill the conflicting process.
- Verify `kubectl top pods -n default -l app=<service>` returns data (requires metrics-server)

**LSI corpus stuck at 0**
```bash
kubectl logs -n default -l app=<service> --tail=5   # Verify logs exist
curl http://127.0.0.1:9090/services                 # Check agent sees the service
```

**TSD/LSI panels empty after connecting**
- Agent needs ~2 min for TSD, ~5 min for LSI to warm up
- Verify service name in Connect modal exactly matches the deployment/container name

**Rollback didn't restore the app**
- If `kubectl scale --replicas=0` was used, BackTrack auto-restores to 1 replica before rollback
- Check rollback history: `curl http://127.0.0.1:9090/rollback/history`

**Prometheus port conflicts with agent**
- Agent runs on `9090` internally, exposed on host port `9091` in Docker Compose
- If running from source and Prometheus is on `9090`, start agent on a different port: `--port 9092`

**High LSI false positives**
- Raise SVD threshold: set `BACKTRACK_SVD_SIMILARITY_THRESHOLD=0.70` in agent env and restart

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/connections` | List all saved connections |
| `POST` | `/api/connections` | Test or create a connection |
| `GET` | `/api/dashboard/overview` | Aggregated service health + anomaly list |
| `GET` | `/api/deployments/history` | Rollout history from kubectl |
| `POST` | `/api/rollback` | Trigger rollback for a service |
| `GET` | `/api/agent?path=<endpoint>` | Proxy to backtrack-agent |
| `GET` | `/api/prometheus/query` | Proxy PromQL query with Bearer auth |
| `POST` | `/api/terminal` | Execute shell command |
| `GET` | `/api/metrics/mttr` | MTTR stats and history |
| `GET` | `/api/metrics/detection` | Confusion matrix + detection entries |

### Agent Endpoints (port 9090)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Agent status and monitored services |
| `GET` | `/services` | Per-service drift/anomaly flags |
| `GET` | `/metrics?service=<name>` | TSD metrics + decomposition + evaluation |
| `GET` | `/lsi?service=<name>` | LSI scores + classified logs + confusion matrix |
| `GET` | `/versions` | Version snapshots |
| `GET` | `/rollback/history` | Rollback event log |
| `POST` | `/rollback/trigger` | Manually trigger rollback |
| `POST` | `/reconfigure` | Hot-reload target/services without restart |

---

## Security Notes

BackTrack is designed for **local or internal operator use only**.

- `/api/terminal` executes arbitrary shell commands — do not expose publicly
- Connection tokens stored in `.backtrack/connections.json` (plain text)
- No authentication or RBAC by default

---

## License

MIT — see LICENSE file.
