# BackTrack — Setup Guide

This guide covers every way to run BackTrack: Docker Hub (fastest), Kubernetes mode, and from source.

---

## Table of Contents

- [Quick Start — Docker Hub](#quick-start--docker-hub)
- [Kubernetes Mode](#kubernetes-mode)
- [Docker Mode](#docker-mode)
- [From Source](#from-source)
- [Configuration Reference](#configuration-reference)
- [Containerizing a Non-Containerized App](#containerizing-a-non-containerized-app)
- [Prometheus Setup (Optional)](#prometheus-setup-optional)
- [Troubleshooting](#troubleshooting)

---

## Quick Start — Docker Hub

No source code, no Node, no Python. Just Docker.

**Prerequisites:**

| Mode | Requirements |
|------|-------------|
| Docker | Docker Desktop (or Engine + Compose), a running container to monitor |
| Kubernetes | Same, plus kubeconfig accessible on your machine |

### Step 1 — Download and configure

```bash
mkdir backtrack && cd backtrack

curl -O https://raw.githubusercontent.com/KenMarzan/BackTrack/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/KenMarzan/BackTrack/main/.env.example
```

Edit `.env`:

```env
BACKTRACK_TARGET=my-app        # Docker container name or K8s deployment name
BACKTRACK_IMAGE_TAG=latest     # Your current image tag
GITHUB_TOKEN=                  # Optional — for deployment history panel
```

### Step 2 — Start BackTrack

```bash
docker compose up -d
```

This pulls two images from Docker Hub:
- `zeritzuu/backtrack-dashboard` → web UI on **http://localhost:3000**
- `zeritzuu/backtrack-agent` → anomaly engine on port **9091**

### Step 3 — Connect your app

1. Open **http://localhost:3000**
2. Click **Configure Cluster** (top-right)
3. Choose **Docker** or **Kubernetes**
4. Enter your container/deployment name → click **Connect**

BackTrack discovers all services in your cluster and starts monitoring each one individually with its own TSD + LSI collectors.

> **Prometheus URL:** leave blank — BackTrack falls back to `docker stats` / `kubectl top` automatically.

---

## Kubernetes Mode

Mount your kubeconfig into both containers so `kubectl` works inside Docker:

```yaml
# docker-compose.yml additions
services:
  backtrack-dashboard:
    image: zeritzuu/backtrack-dashboard:latest
    volumes:
      - ~/.kube:/root/.kube:ro                  # ← add this
      - /var/run/docker.sock:/var/run/docker.sock
      - backtrack-data:/.backtrack

  backtrack-agent:
    image: zeritzuu/backtrack-agent:latest
    environment:
      - BACKTRACK_MODE=kubernetes
      - BACKTRACK_K8S_NAMESPACE=default         # ← your namespace
    volumes:
      - ~/.kube:/root/.kube:ro                  # ← add this
      - /var/run/docker.sock:/var/run/docker.sock
      - backtrack-data:/data
```

Then restart:

```bash
docker compose down && docker compose up -d
```

In the dashboard Connect modal:
- **Platform** → Kubernetes
- **Application name** → your cluster label (e.g. `microservice-demo`)
- **Namespace** → `default` (or your namespace)
- **Architecture** → Microservices — discover all

BackTrack auto-discovers all deployments in the namespace. Each service gets its own TSD and LSI collector.

### Label selector

BackTrack uses `app=<service-name>` as the pod label selector. Verify your pods have this label:

```bash
kubectl get pods -n default --show-labels | head -5
```

Expected: `app=frontend`, `app=checkoutservice`, etc.

### Prometheus (optional, for accurate request rate)

Without Prometheus, BackTrack uses `kubectl top` for CPU/memory and HTTP probing for latency. Request rate will show a proxy value.

For full metrics, install kube-prometheus-stack:

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install monitoring prometheus-community/kube-prometheus-stack -n monitoring --create-namespace
```

Then set the Prometheus URL in the Connect modal:

```
http://monitoring-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090
```

Or port-forward locally and use `http://localhost:9090`.

---

## Docker Mode

Docker mode requires only the container name. No cluster configuration needed.

1. Open **http://localhost:3000**
2. Click **Configure Cluster**
3. **Platform** → Docker
4. **Application name** → exact container name (find it with `docker ps --format "{{.Names}}"`)
5. Click **Connect**

The agent monitors that container via Docker SDK (CPU, memory) and log tailing (LSI). The Docker socket must be mounted in both containers (already done in the default `docker-compose.yml`).

---

## From Source

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
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 9090
```

> **Port conflict:** if `kubectl port-forward` is also using port 9090, the dashboard may hit the wrong process. Either kill the port-forward or set `BACKTRACK_AGENT_URL=http://127.0.0.1:9090` in `backtrack-dashboard/.env.local`.

### 4. Connect

Click **Configure Cluster** in the dashboard → fill in the form → Connect.

---

## Configuration Reference

### Agent — environment variables

| Variable | Default | Description |
|---|---|---|
| `BACKTRACK_TARGET` | _(optional)_ | Deployment name (K8s) or container name (Docker). Blank = auto-discover all. |
| `BACKTRACK_IMAGE_TAG` | `unknown` | Current image tag for version snapshot tracking |
| `BACKTRACK_MODE` | auto-detected | `kubernetes` or `docker` |
| `BACKTRACK_K8S_NAMESPACE` | `default` | Kubernetes namespace to watch |
| `BACKTRACK_ROLLBACK_ENABLED` | `true` | Set `false` to disable automatic rollback |
| `BACKTRACK_ROLLBACK_COOLDOWN` | `120` | Seconds between consecutive rollbacks |
| `BACKTRACK_SCRAPE_INTERVAL` | `10` | Seconds between metric scrapes |
| `BACKTRACK_STABLE_SECONDS` | `600` | Clean seconds before marking a version STABLE |
| `BACKTRACK_TSD_IQR_MULTIPLIER` | `3.0` | Drift sensitivity — lower = more sensitive |
| `BACKTRACK_LSI_SCORE_MULTIPLIER` | `2.0` | Log anomaly sensitivity — lower = more sensitive |
| `BACKTRACK_SVD_SIMILARITY_THRESHOLD` | `0.55` | SVD cosine similarity cutoff — raise to reduce LSI false positives |
| `BACKTRACK_CORPUS_SIZE` | `200` | Log lines before fitting the LSI model |
| `BACKTRACK_BASELINE_WINDOWS` | `10` | Scoring windows before locking the LSI baseline |
| `BACKTRACK_WINDOW_SECONDS` | `30` | LSI scoring window duration |
| `BACKTRACK_DATA_DIR` | `/data` | Directory for rollback log and version snapshots |

### Dashboard — `.env.local`

| Variable | Default | Description |
|---|---|---|
| `BACKTRACK_AGENT_URL` | `http://127.0.0.1:9090` | URL of the running backtrack-agent |
| `GITHUB_TOKEN` | _(optional)_ | GitHub PAT for the deployment history panel |

---

## Containerizing a Non-Containerized App

BackTrack monitors Docker containers and Kubernetes pods. If your app is a bare process, wrap it first.

**Node.js:**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

**Python:**

```dockerfile
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

Then connect from BackTrack using **Docker** mode with `App Name: my-app`.

---

## Prometheus Setup (Optional)

Without Prometheus, BackTrack uses these fallbacks:

| Metric | Fallback |
|--------|---------|
| CPU | `kubectl top pods` |
| Memory | `kubectl top pods` |
| Request rate | HTTP latency probe (1 req/10s proxy) |
| Error rate | Not available |
| Pod status | `kubectl get pods` (live) |

For accurate request rate and error rate, install Prometheus with kube-prometheus-stack (see [Kubernetes Mode](#kubernetes-mode) above).

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
- Check for port conflict: `ss -tlnp | grep 9090` — if `kubectl port-forward` is on 9090, it intercepts requests. Use `http://127.0.0.1:9090` explicitly or kill the conflicting process.
- Verify `kubectl top pods -n default -l app=<service>` returns data (requires metrics-server).

**LSI corpus stuck at 0 lines**
```bash
kubectl logs -n default -l app=<service> --tail=5   # Verify logs exist
curl http://127.0.0.1:9090/services                 # Check agent sees the service
```

**TSD/LSI panels empty after connecting**
- Agent needs ~2 min for TSD, ~5 min for LSI to warm up.
- Verify service name in Connect modal matches the deployment/container name exactly.

**Rollback didn't restore the app**
- BackTrack auto-restores replicas if scaled to 0 before running `rollout undo`.
- Check history: `curl http://127.0.0.1:9090/rollback/history`

**High LSI false positives**
- Raise SVD threshold: `BACKTRACK_SVD_SIMILARITY_THRESHOLD=0.70` and restart agent.
