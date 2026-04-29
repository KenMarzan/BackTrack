# BackTrack

> **Local-first observability, anomaly detection, and autonomous self-healing rollback for Kubernetes and Docker workloads.**

BackTrack watches your containerized services in real time, detects metric drift and log anomalies using two independent ML algorithms (TSD and LSI), and automatically rolls back to the last stable version when thresholds are breached — no cloud dependency, no SaaS, no agent phone-home.

---

## Screenshots

### Dashboard — Live Telemetry
![Anomaly Detection panel showing all systems nominal](docs/screenshots/anomaly-detection-nominal.png)
> Main dashboard. Container Health chart, Recent Deployments, Anomaly Detection panel (Critical · High · Medium counters), and Active Containers table. When all services are clean the anomaly panel shows a green "All systems nominal" state.

### Anomalies — TSD + LSI Live Panels
![Anomalies page with TSD and LSI panels](docs/screenshots/anomalies-tsd-lsi.png)
> Anomalies page with the agent online. Left: interactive kubectl terminal. Right: TSD Metrics (CPU · Memory · Latency · Error Rate) and LSI Analysis (score vs threshold, score history chart, classified recent log lines).

### Anomalies — Full Live View
![Anomalies page live view](docs/screenshots/anomalies-page.png)
> Full anomalies page. TSD metrics update every 10 s. LSI score history chart fills as the corpus grows. Log lines are classified in real time as INFO · WARN · ERROR · NOVEL.

### Service Diagnostics — Per-Service Drill-Down
![Service diagnostics page](docs/screenshots/service-diagnostics.png)
> Drill-down per service. Left: tabbed TSD/LSI panels with residual sparklines and score history. Centre: classified log stream with NOVEL pattern separation. Right: root cause analysis, diagnostic summary, agent status, rollback action.

---

## What It Does

| Capability | Description |
|---|---|
| **Service Discovery** | Auto-discovers pods/containers via `kubectl` or `docker ps` |
| **Live Metrics** | Polls Prometheus for CPU, memory, request rate — falls back to `kubectl top` |
| **TSD — Time Series Decomposition** | STL decomposition into Seasonal · Trend · Residual; flags drift when residuals exceed 3×IQR for 3 consecutive readings |
| **LSI — Latent Semantic Indexing** | TF-IDF + SVD on live log lines; classifies each line as INFO/WARN/ERROR/NOVEL; triggers when score exceeds the baseline threshold |
| **Auto-Rollback** | After 3 consecutive anomaly cycles (~90 s), rolls back the deployment to the last STABLE snapshot |
| **Kubectl Terminal** | Interactive terminal embedded in the Anomalies page for live cluster commands |
| **Rollback History** | Full audit trail of every rollback event with reason, from/to version, and success status |

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
└───────────────┬─────────────────┬────────────────────────┘
                │                 │
          kubectl/docker     HTTP :9090
                │                 │
    ┌───────────▼────┐   ┌────────▼───────────────┐
    │  Your Cluster  │   │   backtrack-agent       │
    │  or Docker     │   │   Python · FastAPI      │
    │  runtime       │   │                         │
    └────────────────┘   │  TSD collector          │
                         │  LSI log analyser        │
                         │  Version snapshotter     │
                         │  Rollback executor       │
                         └─────────────────────────┘
```

### Data Flow

1. **Connect** → Configure Cluster modal → `POST /api/connections` → discovers services via kubectl/docker → persists to `.backtrack/connections.json`
2. **Dashboard polling** → `GET /api/dashboard/overview` every 10 s → queries Prometheus (or falls back to `kubectl top`)
3. **Agent polling** → `GET /api/agent?path=metrics|lsi|versions` every 5 s → live TSD/LSI state from the agent
4. **Anomaly detection** → agent compares current metrics/logs against locked baseline; raises drift or anomalous flag
5. **Auto-rollback** → after 3 consecutive anomaly cycles the agent executes `kubectl rollout undo` or Docker image swap

---

## Compatibility

BackTrack monitors apps running as **Docker containers** or **Kubernetes pods**.

| Your app is running as… | Supported? | What to do |
|---|---|---|
| Docker container | ✅ Yes | Use **Docker** mode in the connection modal |
| Kubernetes pod / deployment | ✅ Yes | Use **Kubernetes** mode in the connection modal |
| Bare process / systemd / VM | ❌ Not directly | Containerize it first — see below |
| Serverless (Lambda, Cloud Run) | ❌ Not directly | Out of scope — BackTrack targets long-running workloads |

### Containerizing a Non-Containerized App

Wrap your app in Docker first — then BackTrack can discover it via Docker mode.

**Add a `Dockerfile`:**

```dockerfile
# Node.js
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```dockerfile
# Python
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "app.py"]
```

**Build and run with a stable name:**

```bash
docker build -t my-app:latest .
docker run -d --name my-app -p 3000:3000 my-app:latest
```

**Verify:**

```bash
docker ps --filter "name=my-app"
```

Then connect from BackTrack using **Docker** mode with `App Name: my-app`.

---

## Quick Start — Docker Hub (Fastest)

No source code, no Node, no Python. Just Docker.

### Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin)
- A running cluster: local Docker containers **or** a Kubernetes cluster

### Step 1 — Create a project folder

```bash
mkdir backtrack && cd backtrack
```

### Step 2 — Download two files

```bash
# docker-compose.yml
curl -O https://raw.githubusercontent.com/KenMarzan/BackTrack/main/docker-compose.yml

# .env
curl -o .env https://raw.githubusercontent.com/KenMarzan/BackTrack/main/.env.example
```

### Step 3 — Edit `.env`

```env
# Name of your Docker container or Kubernetes deployment to monitor
BACKTRACK_TARGET=my-app

# Image tag for rollback snapshot reference
BACKTRACK_IMAGE_TAG=v1.0.0

# GitHub token — optional, only for the deployment history panel
GITHUB_TOKEN=
```

### Step 4 — Pull and start

```bash
docker compose pull
docker compose up
```

This pulls two images from Docker Hub:
- `zeritzuu/backtrack-dashboard` → web UI on port **3000**
- `zeritzuu/backtrack-agent` → anomaly engine on port **9090**

Open **http://localhost:3000**

### Step 5 — Connect your cluster

1. Click **Configure Cluster** top-right
2. Choose **Docker** or **Kubernetes**
3. Fill in the form and click **Test Connection** → **Connect**

> **Prometheus URL:** leave blank unless you have Prometheus running. BackTrack falls back to `docker stats` / `kubectl top`.

---

## Setup — Kubernetes Mode (Docker Hub)

Edit `docker-compose.yml` — mount your kubeconfig into the dashboard container and configure the agent:

```yaml
services:
  backtrack-dashboard:
    image: zeritzuu/backtrack-dashboard:latest
    volumes:
      - ~/.kube:/root/.kube:ro          # ← add this line
      - /var/run/docker.sock:/var/run/docker.sock
      - backtrack-data:/.backtrack

  backtrack-agent:
    image: zeritzuu/backtrack-agent:latest
    environment:
      - BACKTRACK_TARGET=my-deployment
      - BACKTRACK_IMAGE_TAG=v1.0.0
      - BACKTRACK_MODE=kubernetes        # ← add this
      - BACKTRACK_K8S_NAMESPACE=default  # ← add this
```

Then restart:

```bash
docker compose down && docker compose up
```

---

## Setup — From Source

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20+ |
| npm | 10+ |
| Python | 3.10+ |
| kubectl | any |
| Docker CLI | any |

### 1. Clone

```bash
git clone https://github.com/KenMarzan/BackTrack.git
cd BackTrack
```

### 2. Start the dashboard

```bash
cd backtrack-dashboard
npm install
npm run dev
```

Open **http://localhost:3000**

### 3. Start the agent

```bash
cd backtrack-agent
pip install -r requirements.txt
cp .env.example .env   # edit values
python3 -m uvicorn src.main:app --host 0.0.0.0 --port 9090
```

**Kubernetes:**

```bash
BACKTRACK_MODE=kubernetes \
BACKTRACK_TARGET=my-deployment \
BACKTRACK_IMAGE_TAG=v1.0.0 \
BACKTRACK_K8S_NAMESPACE=default \
python3 -m uvicorn src.main:app --host 0.0.0.0 --port 9090
```

**Docker:**

```bash
BACKTRACK_MODE=docker \
BACKTRACK_TARGET=my-container \
BACKTRACK_IMAGE_TAG=v1.0.0 \
python3 -m uvicorn src.main:app --host 0.0.0.0 --port 9090
```

### 4. Connect your cluster

Click **Configure Cluster** in the dashboard and fill in the form.

---

## Configuration

### Agent — `backtrack-agent/.env`

| Variable | Default | Description |
|---|---|---|
| `BACKTRACK_TARGET` | _(required)_ | Deployment name (K8s) or container name (Docker) |
| `BACKTRACK_IMAGE_TAG` | `unknown` | Current image tag for version snapshot tracking |
| `BACKTRACK_MODE` | auto-detected | `kubernetes` or `docker` |
| `BACKTRACK_K8S_NAMESPACE` | `default` | Kubernetes namespace to watch |
| `BACKTRACK_ROLLBACK_ENABLED` | `true` | Set `false` to disable automatic rollback |
| `BACKTRACK_ROLLBACK_COOLDOWN` | `120` | Seconds between consecutive rollbacks |
| `BACKTRACK_SCRAPE_INTERVAL` | `10` | Seconds between metric scrapes |
| `BACKTRACK_STABLE_SECONDS` | `600` | Clean seconds before marking a version STABLE |
| `BACKTRACK_TSD_IQR_MULTIPLIER` | `3.0` | Drift sensitivity — lower = more sensitive |
| `BACKTRACK_LSI_SCORE_MULTIPLIER` | `2.0` | Log anomaly sensitivity — lower = more sensitive |
| `BACKTRACK_CORPUS_SIZE` | `200` | Log lines to collect before fitting the LSI model |
| `BACKTRACK_BASELINE_WINDOWS` | `10` | Scoring windows before locking the LSI baseline |
| `BACKTRACK_WINDOW_SECONDS` | `30` | LSI scoring window duration |
| `BACKTRACK_DATA_DIR` | `/data` | Directory for rollback log and version snapshots |

### Dashboard — `backtrack-dashboard/.env.local`

| Variable | Default | Description |
|---|---|---|
| `BACKTRACK_AGENT_URL` | `http://localhost:9090` | URL of the running backtrack-agent |
| `GITHUB_TOKEN` | _(optional)_ | GitHub PAT for the deployment history panel |

---

## How TSD Works

BackTrack collects CPU, memory, latency, and error rate every 10 seconds. Once 12 readings are available:

1. **STL decomposition** splits each series into **Seasonal** + **Trend** + **Residual**
2. **IQR envelope** computes 3×IQR on historical residuals as the drift boundary
3. **Drift flag** raised when the last 3 consecutive residuals all exceed 3×IQR

Catches gradual degradation (memory leaks, creeping latency) that threshold-only monitors miss.

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

BackTrack tails logs from the target container/pod and processes them in 30-second windows:

1. **Corpus collection** — first 200 log lines build the training set
2. **TF-IDF vectorisation** of each line
3. **SVD** reduces to a latent semantic space; centroids built per class (INFO/WARN/ERROR)
4. **Keyword pre-check** — lines with error/warn keywords fast-pathed before SVD
5. **Anomaly score** = weighted window entropy (`ERROR×3 + NOVEL×5 + WARN×1`) / total; anomalous when `score > 2×baseline_mean` or `score > 1.5` absolute floor

---

## Rollback Flow

**Manual** (Dashboard → Recent Deployments):
1. Click **Rollback** on any non-current stable version
2. Rollback event card appears (amber pulse + progress bar)
3. Card turns green on completion; toast appears bottom-right

**Automatic** (agent-triggered):
1. Agent detects 3 consecutive cycles where TSD drifting **or** LSI anomalous
2. Executes `kubectl rollout undo deployment/<name>` or Docker image swap
3. 120 s cooldown prevents rollback loop
4. Dashboard anomaly row shows **auto-rollback** badge

---

## Pages

### Dashboard (`/`)
- **Container Health** — per-service CPU/memory charts, running/down/unknown status
- **Recent Deployments** — K8s rollout history, BackTrack version snapshots, one-click rollback
- **Anomaly Detection** — live anomaly list with severity chips, auto-rollback badge
- **Active Containers** — table of all discovered services with status, platform, ports

### Anomalies (`/anomalies`)
- **Terminal** — interactive kubectl terminal with syntax-coloured output
- **TSD Metrics** — CPU/Memory/Latency/Error Rate with Season · Trend · Residual values
- **LSI Analysis** — score vs threshold, score history chart, classified log lines

### Service Diagnostics (`/anomalies/[service]`)
- **Left** — TSD tab: live metrics + residual sparklines; LSI tab: score history + log lines
- **Centre** — classified log stream (NOVEL/ERROR/WARN/INFO)
- **Right** — root cause analysis, diagnostic summary, agent status, rollback action

---

## Project Structure

```
BackTrack/
├── backtrack-dashboard/            # Next.js frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx            # Dashboard
│   │   │   ├── anomalies/
│   │   │   │   ├── page.tsx        # Anomalies + Terminal
│   │   │   │   ├── KubernetesTerminal.tsx
│   │   │   │   └── [service]/page.tsx  # Per-service diagnostics
│   │   │   ├── components/
│   │   │   │   ├── Nav.tsx
│   │   │   │   ├── ContainerHealth.tsx
│   │   │   │   ├── AnomalyDetection.tsx
│   │   │   │   ├── ActiveContainers.tsx
│   │   │   │   ├── RecentDeployment.tsx
│   │   │   │   └── RollbackToast.tsx
│   │   │   └── api/
│   │   │       ├── connections/route.ts
│   │   │       ├── dashboard/overview/route.ts
│   │   │       ├── deployments/history/route.ts
│   │   │       ├── rollback/route.ts
│   │   │       ├── agent/route.ts
│   │   │       ├── prometheus/query/route.ts
│   │   │       └── terminal/route.tsx
│   │   └── lib/
│   │       ├── monitoring-store.ts     # File-backed connection store
│   │       └── monitoring-types.ts    # Shared TypeScript types
│   ├── .env.example                   # Dashboard env template
│   └── package.json
│
├── backtrack-agent/                # Python FastAPI anomaly engine
│   ├── src/
│   │   ├── main.py                 # FastAPI entrypoint
│   │   ├── config.py               # Env var config
│   │   ├── versions.py             # Version snapshot store
│   │   ├── collectors/
│   │   │   ├── tsd.py              # Time Series Decomposition
│   │   │   └── lsi.py              # Latent Semantic Indexing
│   │   └── rollback/
│   │       └── executor.py         # Rollback execution
│   ├── .env.example                # Agent env template
│   └── requirements.txt
│
├── docker-compose.yml              # Orchestration (both services)
├── .env.example                    # Root env template (Docker Hub path)
├── .backtrack/                     # Auto-created at runtime
│   └── connections.json            # Persisted connections
└── docs/
    └── screenshots/
```

---

## Troubleshooting

**Dashboard shows no services**
```bash
kubectl config current-context        # Check active K8s context
kubectl get pods -n <namespace>       # Verify pods are running
docker ps                             # Verify Docker containers are up
```

**Agent offline (Anomalies page shows "Agent Offline")**
```bash
curl http://localhost:9090/health     # Should return {"status":"ok"}
```
→ Start or restart the agent. If using Docker Hub, run `docker compose up`.

**Prometheus URL conflicts with agent port**

The agent runs on port `9090`. If you also run Prometheus on `9090`, either:
- Leave the Prometheus URL field blank in the connection modal (uses `kubectl top` fallback)
- Change the agent port: `--port 9091` and set `BACKTRACK_AGENT_URL=http://localhost:9091` in `backtrack-dashboard/.env.local`

**TSD/LSI panels empty after several minutes**
- Verify `BACKTRACK_TARGET` exactly matches your deployment/container name
- Check agent logs: `docker compose logs backtrack-agent` or the running terminal
- Run `curl http://localhost:9090/services` to confirm the agent sees your service

**Metrics show all zeros (CPU/Memory = 0)**
- No Prometheus? That's fine — fallback to `kubectl top`. Ensure metrics-server is installed in K8s
- If Prometheus is configured, test PromQL queries directly in the Prometheus UI

**Rollback not triggering automatically**
- Either TSD drift or LSI anomaly must be active for 3 consecutive cycles
- Verify `BACKTRACK_ROLLBACK_ENABLED=true`
- Check rollback history: `curl http://localhost:9090/rollback/history`
- If rollback fired recently, the 120 s cooldown may be active

**`pip install` prompt shown in the UI (Docker Hub users)**

That hint is for source-code users only. If you used `docker compose up`, the agent is already running — ignore the pip install message.

**Kubernetes: service discovery finds no pods**
```bash
kubectl get pods -n default -l app=<your-app>    # Verify label selector matches
kubectl cluster-info                              # Verify cluster is reachable
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/connections` | List all saved connections |
| `POST` | `/api/connections` | Test or create a connection (`action: test\|connect`) |
| `GET` | `/api/dashboard/overview` | Aggregated service health + anomaly list |
| `GET` | `/api/deployments/history` | Rollout history from kubectl |
| `POST` | `/api/rollback` | Trigger rollback for a service |
| `GET` | `/api/agent?path=<endpoint>` | Proxy to backtrack-agent (health / metrics / lsi / versions) |
| `GET` | `/api/prometheus/query` | Proxy PromQL query with Bearer auth |
| `POST` | `/api/terminal` | Execute shell command, returns stdout/stderr |

---

## Security Notes

BackTrack is designed for **local or internal operator use only**.

- `/api/terminal` executes arbitrary shell commands — do not expose publicly
- Prometheus auth token stored in `.backtrack/connections.json` (plain text)
- No authentication or RBAC by default
- Add authentication middleware before deploying to shared or production environments

---

## License

MIT — see LICENSE file.
