# BackTrack

BackTrack is a local-first observability dashboard for Kubernetes and Docker workloads. It helps you:

- discover services from a cluster or local Docker runtime,
- query Prometheus for health and runtime metrics,
- visualize service and anomaly states in one UI,
- run quick terminal commands from the anomaly screen.

This project is built with Next.js App Router, React 19, Tailwind CSS, and Chart.js.

## Table of Contents

- Overview
- Architecture
- Prerequisites
- Quick Start
- Configuration Guide
- Workarounds and Troubleshooting
- API Reference
- Customization Guide
- Security Notes
- Known Limitations
- Roadmap Suggestions

## Overview

BackTrack currently focuses on a practical workflow:

1. Configure cluster/runtime details from the UI.
2. Discover services automatically.
3. Persist connections locally.
4. Poll Prometheus and compute service health.
5. Display dashboard cards/tables/charts and anomaly events.

### Health evaluation behavior

For Kubernetes services, BackTrack combines two signals:

- pod-level scrape state from up with job kubernetes-pods,
- blackbox TCP probe state from probe_success with job kubernetes-services-tcp.

If no sample exists yet for a service in Prometheus, status remains unknown (instead of down).

## Architecture

### Main UI screens

- Dashboard home: service health, metrics, active containers, anomalies.
- Anomalies screen: interactive terminal panel.

### API routes

- GET /api/connections
	- list saved connections.
- POST /api/connections
	- discover and optionally register a connection.
	- actions: test, connect.
- GET /api/dashboard/overview
	- aggregate service status and metric snapshots for dashboard widgets.
- GET /api/prometheus/query
	- proxy arbitrary PromQL query for a selected connection.
- POST /api/terminal
	- execute shell command and return stdout/stderr.

### Persistence

Connections are stored in:

- .backtrack/connections.json

The app also keeps an in-memory copy for runtime speed.

## Prerequisites

- Node.js 20+
- pnpm (recommended), npm, yarn, or bun
- For Kubernetes mode:
	- kubectl installed on host running BackTrack
	- valid kube context and namespace access
	- Prometheus endpoint reachable from BackTrack
- For Docker mode:
	- docker CLI installed
	- user has permission to run docker ps

## Quick Start

1. Install dependencies:

		pnpm install

2. Start development server:

		pnpm dev

3. Open:

		http://localhost:3000

4. Click Configure Cluster and fill:

- Application Name
- Platform (kubernetes or docker)
- Architecture (microservices or monolith)
- Cluster Name
- API Server Endpoint
- Prometheus URL
- Namespace
- Optional service account token

5. Use Test Connection first, then Connect.

## Configuration Guide

BackTrack is currently configured via UI input and source constants (no dedicated env file yet).

### Connection form settings

- Application Name
	- Used for monolith-focused filtering during discovery.
- Platform
	- kubernetes: uses kubectl discovery.
	- docker: uses docker ps discovery.
- Architecture
	- microservices: broad discovery.
	- monolith: app-name-focused discovery.
- Namespace
	- default namespace for discovery and Prometheus label filters.
- Prometheus URL
	- base URL to query /api/v1/query.
- Auth Token
	- optional Bearer token for secured Prometheus endpoints.

### Polling interval

Dashboard refresh interval is currently 10 seconds.

To customize:

- Edit Home page polling timer in src/app/page.tsx.

### Metric and anomaly thresholds

Current anomaly logic includes:

- critical when service status is down,
- warning when memory usage is greater than 120 MiB.

To customize:

- Edit thresholds and rules in src/app/api/dashboard/overview/route.ts.

### Data retention behavior

- Connections persist in .backtrack/connections.json.
- Registering a connection with same app name + namespace + platform replaces older entry.

## Workarounds and Troubleshooting

This section covers known operational issues and practical workarounds.

### 1) Prometheus target shows unknown or never scraped

Symptoms:

- Target appears in Prometheus but Last scrape is never.
- Dashboard service status remains unknown.

Why this happens:

- Discovery exists, but Prometheus has not produced a sample for that label set yet.

Workarounds:

1. Verify target appears in Prometheus Targets for job kubernetes-services-tcp.
2. Run query in Prometheus UI:

			 probe_success{job="kubernetes-services-tcp",kubernetes_namespace="default",service="YOUR_SERVICE"}

3. Confirm labels match exactly: service, kubernetes_namespace, and job.
4. Validate DNS/connectivity from blackbox exporter pod to service endpoint.
5. Wait for one full scrape interval after relabel changes.

### 2) Dashboard shows missing metrics (CPU, Memory, Request Rate = 0)

Symptoms:

- Service appears, but numeric metrics are zero.

Why this happens:

- PromQL selectors do not match labels in your cluster metrics.

Workarounds:

1. Test selectors manually in Prometheus expression browser.
2. Adjust pod/app label filters in src/app/api/dashboard/overview/route.ts.
3. If your metrics use different label keys, update query labels accordingly.

### 3) Kubernetes discovery fails

Symptoms:

- Error mentioning kubectl service discovery failed.

Why this happens:

- kubectl missing, wrong context, or insufficient RBAC.

Workarounds:

1. Check kubectl availability:

			 kubectl version --client

2. Check active context:

			 kubectl config current-context

3. Verify namespace resources are readable:

			 kubectl get svc -n YOUR_NAMESPACE
			 kubectl get pods -n YOUR_NAMESPACE

4. Fix kubeconfig/context or run BackTrack in environment with correct credentials.

### 4) Docker discovery fails

Symptoms:

- Error mentioning docker discovery failed.

Why this happens:

- Docker daemon not running or permission denied.

Workarounds:

1. Validate daemon:

			 docker ps

2. Ensure user belongs to docker group or run with proper permissions.

### 5) Empty dashboard after connect

Symptoms:

- Connect succeeds but no useful data in table/charts.

Why this happens:

- Discovery returned zero services, or service filters are too strict for your naming.

Workarounds:

1. Use Test Connection and check discovered service count.
2. Switch architecture to microservices for broad discovery.
3. Verify namespace input matches real deployment namespace.

### 6) Terminal command execution concerns

Symptoms:

- You need safer command execution policy.

Why this happens:

- Current terminal API executes raw shell command text.

Workarounds:

1. Restrict deployment of /api/terminal to trusted/internal environments only.
2. Replace free-form execution with allowlisted commands in API route.
3. Add authentication/authorization middleware before production use.

## API Reference

### GET /api/connections

Response:

- list of normalized connection records.

### POST /api/connections

Request body fields:

- action: test | connect
- appName
- platform: kubernetes | docker
- architecture: monolith | microservices
- clusterName
- namespace
- apiServerEndpoint
- prometheusUrl
- authToken (optional)

Behavior:

- test: only discovers services.
- connect: discovers and persists connection.

### GET /api/dashboard/overview

Response:

- generatedAt
- services array
- anomalies array

### GET /api/prometheus/query

Query params:

- connectionId
- query

Returns upstream response wrapper including connectionId, upstream status, and data.

### POST /api/terminal

Request body:

- command

Returns:

- output
- error

## Customization Guide

Use this section to adapt BackTrack to your own environment and style.

### 1) Branding and visual theme

Edit:

- src/app/globals.css
- src/app/components/Nav.tsx
- src/app/page.tsx

Recommended customizations:

- app title text and cluster status line,
- color palette,
- widget spacing and layout proportions,
- iconography (lucide-react).

### 2) Dashboard layout composition

Edit:

- src/app/page.tsx
- src/app/components/ContainerHealth.tsx
- src/app/components/ActiveContainers.tsx
- src/app/components/AnomalyDetection.tsx

Examples:

- change card ordering,
- add status chips for running/down/unknown counts,
- add sortable columns in active containers table.

### 3) Discovery logic tuning

Edit:

- src/app/api/connections/route.ts

You can tune:

- monolith filtering strategy,
- label matching rules,
- service-to-pod relationship mapping.

### 4) PromQL and health model

Edit:

- src/app/api/dashboard/overview/route.ts

You can tune:

- metric queries for your label schema,
- health priority between pod-level and blackbox signals,
- anomaly thresholds and severity mapping.

### 5) Persistence strategy

Edit:

- src/lib/monitoring-store.ts

You can replace local file storage with:

- SQLite,
- PostgreSQL,
- Redis,
- external config service.

### 6) Connection form UX

Edit:

- src/app/components/Nav.tsx

You can add:

- form presets per environment,
- extra validation,
- required-field checks before API call,
- hidden advanced options toggles.

## Security Notes

Before production use, review these points:

- The terminal API currently executes arbitrary commands from request input.
- Prometheus token is stored with connection data.
- Connection persistence is local file based and not encrypted by default.

Minimum hardening recommendations:

1. Disable or protect terminal API with authentication.
2. Store secrets in a dedicated secret manager, not plain file.
3. Add server-side validation and endpoint allowlists.
4. Restrict network access to trusted operator segment.

## Known Limitations

- No rollback route implementation yet (folder exists, route is empty).
- No built-in authentication/authorization.
- No role-based access model.
- No migration/versioning for local connection store.
- Prometheus query model assumes specific label keys and metric names.

## Roadmap Suggestions

If you want to evolve this project, prioritize:

1. Add authentication and role-based access.
2. Implement safe command execution with allowlists.
3. Add environment-based configuration file support.
4. Add rollback API and audited action history.
5. Add test suite for API routes and query adapters.

## License

Add your preferred license in this repository once legal requirements are finalized.
