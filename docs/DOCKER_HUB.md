# BackTrack — Docker Hub Quick Start

> If you're using BackTrack images from Docker Hub (not building from source), follow this guide.

---

## Prerequisites

- Docker + Docker Compose installed
- A running application (container or Kubernetes deployment)
- Access to the BackTrack dashboard on port `3847`

---

## Step 1 — Download Compose File & Env Template

```bash
mkdir backtrack && cd backtrack

# Download the Docker Hub compose (no source code required)
curl -O https://raw.githubusercontent.com/KenMarzan/BackTrack/main/docker-compose.hub.yml

# Download env template
curl -O https://raw.githubusercontent.com/KenMarzan/BackTrack/main/.env.example
cp .env.example .env
```

---

## Step 2 — Configure `.env`

Edit `.env` with the values you know at startup. The dashboard's **Configure Cluster** flow can fill in the target later.

### Required at startup

```env
BACKTRACK_IMAGE_TAG=latest                 # Your app's current image tag
BACKTRACK_MODE=docker                      # or kubernetes
```

### Optional now, can be set in the dashboard later

```env
BACKTRACK_TARGET=                           # Leave blank until Configure Cluster runs
```

If you already know the target and want to prefill it, you can still set it now.

Find your container name:
```bash
docker ps --format "{{.Names}}"
```

### For Kubernetes Mode (monitoring a deployment)

```env
BACKTRACK_IMAGE_TAG=v1.2.3                 # Your app's current image tag
BACKTRACK_MODE=kubernetes
BACKTRACK_K8S_NAMESPACE=default             # Your namespace
```

If you want to prefill the deployment target, you may set:

```env
BACKTRACK_TARGET=my-deployment             # Optional until you use Configure Cluster
```

Find your deployments:
```bash
kubectl get deployments -n default
```

**Optional but recommended:** Add kubeconfig mount to `docker-compose.hub.yml`:

In the `backtrack-dashboard` and `backtrack-agent` services, uncomment:
```yaml
volumes:
  - ~/.kube:/root/.kube:ro
```

Then restart:
```bash
docker compose -f docker-compose.hub.yml down
docker compose -f docker-compose.hub.yml up -d
```

### Optional: GitHub Token

To enable the "Recent Deployments" panel, add your token:

```env
GITHUB_TOKEN=ghp_xxxxx     # Your GitHub personal access token
```

---

## Step 3 — Start BackTrack

```bash
docker compose -f docker-compose.hub.yml up -d
```

Check logs:
```bash
docker compose -f docker-compose.hub.yml logs -f
```

---

## Step 4 — Open the Dashboard

Open your browser:
```
http://localhost:3847
```

You should see:
- **Agent status**: "Agent Online" (green badge on Anomalies page after ~10s)
- **Active Containers**: Your app listed in the top table
- **CPU/Memory charts**: Begin populating after ~20s

---

## Step 5 — Optional: Configure via Dashboard

Use this step to finish setup when you left `BACKTRACK_TARGET` empty at startup, or to change the target later:

1. Click **Configure Cluster** (top-right button)
2. Select your **Platform** and **Architecture**
3. Enter your **Application name** / **Namespace**
4. Click **Test Connection** → **Connect**

The agent will hot-reload to monitor the new services without a restart.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Agent won't start | Check `.env` exists, `BACKTRACK_MODE` matches your setup, and the dashboard container is reachable. `BACKTRACK_TARGET` may be blank until you use Configure Cluster. Run `docker compose -f docker-compose.hub.yml logs backtrack-agent` |
| "Agent Offline" badge | Agent container crashed. Check logs: `docker compose -f docker-compose.hub.yml logs backtrack-agent` |
| No containers/pods showing | Wrong `BACKTRACK_TARGET` or wrong namespace. Run `docker ps` or `kubectl get deployments -n <namespace>` to verify. |
| Permission denied on docker.sock | Docker socket mount failed. Ensure `/var/run/docker.sock` exists and your user can access it: `ls -l /var/run/docker.sock` |
| Kubeconfig errors (K8s mode) | Mount `~/.kube:/root/.kube:ro` in both services. Verify kubeconfig with `kubectl cluster-info`. |

---

## Updating Images

When new versions are pushed to Docker Hub:

```bash
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml down
docker compose -f docker-compose.hub.yml up -d
```

---

## Support

- **Dashboard**: http://localhost:3847
- **Agent API**: http://localhost:8847/health
- **GitHub**: https://github.com/KenMarzan/BackTrack/issues
