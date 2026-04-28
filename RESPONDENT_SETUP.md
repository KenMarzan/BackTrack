# BackTrack — Respondent Setup Checklist

## Prerequisites

- [ ] Node.js 20 or higher installed
- [ ] Python 3.10 or higher installed
- [ ] `kubectl` installed and configured **OR** Docker CLI installed
- [ ] Your application is already running (Kubernetes deployment or Docker container)

---

## Step 1 — Run BackTrack Dashboard

```bash
# Clone or receive the BackTrack project folder, then:
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## Step 2 — Connect Your Application

1. Click **Configure Cluster** (top-right button)
2. Fill in the form:

| Field | What to enter |
|-------|---------------|
| Application name | Your app's name (e.g. `myapp`) |
| Platform | `Kubernetes` or `Docker` |
| Architecture | `Monolith` (single app) or `Microservices` |
| Cluster name | Any label (e.g. `local-cluster`) |
| API Server Endpoint | Run `kubectl cluster-info` to get this |
| Namespace | Your deployment namespace (default: `default`) |
| Service account token | Run: `kubectl create token default --duration=24h` |

3. Click **Test Connection** first — confirm services are discovered
4. Click **Connect**

---

## Step 3 — Start the BackTrack Agent (Required for anomaly detection)

The agent enables **LSI log analysis**, **TSD metric drift detection**, and **automatic rollback**.

### For Kubernetes

```bash
cd backtrack-agent
pip install -r requirements.txt

BACKTRACK_MODE=kubernetes \
BACKTRACK_K8S_NAMESPACE=<your-namespace> \
BACKTRACK_TARGET=<your-deployment-name> \
BACKTRACK_IMAGE_TAG=<current-image-tag> \
python3 -m uvicorn src.main:app --host 0.0.0.0 --port 9090
```

### For Docker

```bash
cd backtrack-agent
pip install -r requirements.txt

BACKTRACK_MODE=docker \
BACKTRACK_TARGET=<your-container-name> \
BACKTRACK_IMAGE_TAG=<current-image-tag> \
python3 -m uvicorn src.main:app --host 0.0.0.0 --port 9090
```

**Keep this terminal open.** The agent must stay running while you use BackTrack.

---

## Step 4 — Verify Everything Works

| Check | Where to look |
|-------|--------------|
| Dashboard shows services | Home page → Active Containers table |
| CPU/Memory charts populate | Home page → Container Health panel |
| Agent online indicator | Anomalies page → green "Agent Online" badge |
| TSD metrics appear | Anomalies page → right panel (takes ~2 min for baseline) |
| LSI analysis appears | Anomalies page → right panel (takes ~3 min for corpus) |

---

## Anomaly Detection Timing

After the agent starts:

| Milestone | Time |
|-----------|------|
| TSD starts collecting metrics | Immediately |
| TSD ready for drift detection | ~2 minutes (12 readings) |
| LSI corpus filled | ~3 minutes (200 log lines) |
| Version marked STABLE | 10 minutes of clean operation |
| Auto-rollback triggers | After 3 consecutive anomaly cycles (~90 seconds) |

---

## Quick Reference — Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKTRACK_TARGET` | _(required)_ | Docker container name or K8s deployment name |
| `BACKTRACK_MODE` | auto-detected | `kubernetes` or `docker` |
| `BACKTRACK_K8S_NAMESPACE` | `default` | Kubernetes namespace to watch |
| `BACKTRACK_K8S_LABEL_SELECTOR` | _(optional)_ | e.g. `app=myapp` (overrides TARGET for K8s discovery) |
| `BACKTRACK_IMAGE_TAG` | `unknown` | Current version tag for snapshot tracking |
| `BACKTRACK_ROLLBACK_ENABLED` | `true` | Set to `false` to disable automatic rollback |
| `BACKTRACK_TSD_IQR_MULTIPLIER` | `3.0` | Sensitivity for metric drift detection (lower = more sensitive) |
| `BACKTRACK_LSI_SCORE_MULTIPLIER` | `2.0` | Sensitivity for log anomaly detection (lower = more sensitive) |

---

## Troubleshooting

**Dashboard shows no services**
→ Check kubectl context: `kubectl config current-context`
→ Verify namespace: `kubectl get pods -n <namespace>`

**Agent offline badge on Anomalies page**
→ Agent not running — follow Step 3
→ Confirm agent is on port 9090: `curl http://localhost:9090/health`

**TSD/LSI panels empty after 5 minutes**
→ Check agent logs in the terminal where you ran `python3 -m uvicorn ...`
→ Verify `BACKTRACK_TARGET` matches the actual container/deployment name exactly

**Rollback not triggering**
→ Both TSD drift AND LSI anomaly must be true for 3 consecutive cycles
→ Check `BACKTRACK_ROLLBACK_ENABLED` is not set to `false`
→ View rollback history: `curl http://localhost:9090/rollback/history`
