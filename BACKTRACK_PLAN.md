Backtrack — thesis MVP spec
Goal: detect production runtime errors within 2–5 minutes of deploy and auto-rollback before real users are affected. Works on any tech stack.
Architecture: Python sidecar agent + Next.js/TypeScript dashboard. Attaches to Docker Compose or Kubernetes automatically via env vars / labels. No AI at runtime — pure algorithmic detection.
Components: TSD collector (CPU, memory, latency, error rate over a rolling window), LSI collector (log tail scoring ERROR/WARN/INFO ratio), anomaly detection engine (threshold + statistical rules), version snapshot store (saves last N stable image tags on every healthy deploy), rollback executor (kubectl rollout undo or docker re-deploy), Next.js dashboard (live charts, rollback history, fully responsive).
Errors targeted: runtime logical errors, environmental errors, application errors that pass build/test but break in production.
Dev tool: Claude Code accelerates all scaffolding, logic, tests, and docs. Not part of the deployed image.
14-day sprint: Week 1 builds the agent core (collectors, auto-config, version store). Week 2 builds rollback + dashboard + tests on 2 real GitHub repos.
