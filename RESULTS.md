# Backtrack — Evaluation Results

## Test Methodology

Each test follows an identical procedure using `tests/inject_failure.py`:

1. Deploy a clean application version and wait for Backtrack to mark it **STABLE** (10 minutes of clean metrics).
2. Inject a "bad" container that logs continuous errors and responds with 503/high latency.
3. Measure time from injection to **anomaly detection** (TSD drifting + LSI anomalous).
4. Measure time from detection to **rollback completion** (automatic rollback to last stable image tag).
5. Verify the previous stable version is running after rollback.
6. Record false positives observed during the clean baseline period.

Backtrack uses **no AI or LLM at runtime** — detection is purely statistical (STL decomposition + SVD-based log classification).

---

## App 1 Results

| Metric | Value | Target | Pass |
|--------|-------|--------|------|
| Detection time | _TBD_ | < 5 min | |
| Rollback time | _TBD_ | < 2 min | |
| Total time | _TBD_ | < 7 min | |
| False positives | _TBD_ | < 10% | |
| Image tag before | _TBD_ | — | |
| Image tag after rollback | _TBD_ | — | |

**App 1 details:**
- Name: _TBD_
- Tech stack: _TBD_
- Containerized with: Docker Compose

---

## App 2 Results

| Metric | Value | Target | Pass |
|--------|-------|--------|------|
| Detection time | _TBD_ | < 5 min | |
| Rollback time | _TBD_ | < 2 min | |
| Total time | _TBD_ | < 7 min | |
| False positives | _TBD_ | < 10% | |
| Image tag before | _TBD_ | — | |
| Image tag after rollback | _TBD_ | — | |

**App 2 details:**
- Name: _TBD_
- Tech stack: _TBD_ (different from App 1)
- Containerized with: Docker Compose

---

## Comparison

| Metric | App 1 | App 2 | Average |
|--------|-------|-------|---------|
| Detection time (s) | _TBD_ | _TBD_ | _TBD_ |
| Rollback time (s) | _TBD_ | _TBD_ | _TBD_ |
| Total time (s) | _TBD_ | _TBD_ | _TBD_ |
| False positives | _TBD_ | _TBD_ | _TBD_ |

---

## Discussion

### False Positive Analysis

_TBD — Discuss any false positives observed during the 10-minute clean baseline. Explain what triggered them and whether adjusting IQR/LSI multipliers eliminated them._

### Limitations

1. **Cold start**: Backtrack requires 200 log lines to fit the LSI model and 12 metric readings (2 minutes) before TSD can decompose. During this window, no detection occurs.
2. **Single-container focus**: In Docker mode, Backtrack monitors one container at a time. Multi-service orchestration requires one agent per service.
3. **Network partition**: If the agent loses access to the Docker socket or kubectl, it cannot detect or rollback.

### Future Work

1. Multi-service correlation — detect cascading failures across microservices.
2. Prometheus-native scraping — replace Docker stats API with PromQL for richer metrics.
3. Adaptive thresholds — auto-tune IQR and LSI multipliers based on historical false positive rate.
4. Webhook notifications — Slack/PagerDuty alerts on detection and rollback events.

---

## Thesis Measurement Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Time to detect anomaly | < 5 minutes | Core claim: catch errors before real users are impacted |
| Time to complete rollback | < 2 minutes | Proves rollback speed is production-viable |
| False positive rate | < 10% | Proves STL+SVD is stable on clean deployments |
| Tech stack portability | 2 different stacks | Proves language/framework independence |
| Setup time (new user) | < 5 minutes | Proves zero-config claim |
| Dashboard data latency | < 10 seconds | Proves real-time monitoring usability |
