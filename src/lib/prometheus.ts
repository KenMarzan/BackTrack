const RAW_PROMETHEUS_URL =
  process.env.PROMETHEUS_URL ||
  process.env.NEXT_PUBLIC_PROMETHEUS_URL ||
  "http://localhost:9090";

const PROMETHEUS_URL = RAW_PROMETHEUS_URL.replace(
  /\/(api\/v1|query|query_range)\/?$/i,
  "",
);

export interface PrometheusMetric {
  metric: Record<string, string>;
  value: [number, string];
}

export interface AnomalyAlert {
  service: string;
  severity: "CRITICAL" | "HIGH" | "WARNING";
  metric: string;
  baseline: string;
  current: string;
  description: string;
  timestamp: Date;
}

export interface ContainerHealthMetric {
  key: string;
  namespace: string;
  pod: string;
  container: string;
  cpuCores: number;
  memoryBytes: number;
  networkRxBytesPerSec: number;
  networkTxBytesPerSec: number;
  diskReadBytesPerSec: number;
  diskWriteBytesPerSec: number;
  latencyP95Ms: number | null;
}

const pickServiceLabel = (metric: Record<string, string>) =>
  metric.service ||
  metric.app ||
  metric.job ||
  metric.instance ||
  metric.pod ||
  metric.pod_name ||
  metric.container ||
  "unknown";

const pickNamespace = (metric: Record<string, string>) =>
  metric.namespace || metric.kubernetes_namespace || "default";

const pickPod = (metric: Record<string, string>) =>
  metric.pod || metric.pod_name || metric.instance || "unknown";

const pickContainer = (metric: Record<string, string>) =>
  metric.container || metric.container_name || metric.name || "unknown";

const buildContainerKey = (metric: Record<string, string>) =>
  `${pickNamespace(metric)}/${pickPod(metric)}/${pickContainer(metric)}`;

const queryFirstNonEmpty = async (queries: string[]) => {
  for (const q of queries) {
    const result = await queryPrometheus(q);
    if (Array.isArray(result) && result.length > 0) {
      return result;
    }
  }
  return [] as PrometheusMetric[];
};

const upsertContainerMetric = (
  map: Record<string, ContainerHealthMetric>,
  metric: Record<string, string>,
  update: (target: ContainerHealthMetric) => void,
) => {
  const key = buildContainerKey(metric);
  if (!map[key]) {
    map[key] = {
      key,
      namespace: pickNamespace(metric),
      pod: pickPod(metric),
      container: pickContainer(metric),
      cpuCores: 0,
      memoryBytes: 0,
      networkRxBytesPerSec: 0,
      networkTxBytesPerSec: 0,
      diskReadBytesPerSec: 0,
      diskWriteBytesPerSec: 0,
      latencyP95Ms: null,
    };
  }
  update(map[key]);
};

export async function queryPrometheus(query: string) {
  try {
    const axios = (await import("axios")).default;
    const response = await axios.get(`${PROMETHEUS_URL}/api/v1/query`, {
      params: { query },
    });
    const result = response?.data?.data?.result;
    if (!Array.isArray(result)) {
      console.error("Prometheus query error: unexpected response", {
        url: `${PROMETHEUS_URL}/api/v1/query`,
        query,
        data: response?.data,
      });
      return [];
    }
    return result;
  } catch (error) {
    console.error("Prometheus query error:", error);
    return [];
  }
}

export async function queryPrometheusRange(
  query: string,
  startTime: Date,
  endTime: Date,
  step: string = "15s",
) {
  try {
    const axios = (await import("axios")).default;
    const response = await axios.get(`${PROMETHEUS_URL}/api/v1/query_range`, {
      params: {
        query,
        start: Math.floor(startTime.getTime() / 1000),
        end: Math.floor(endTime.getTime() / 1000),
        step,
      },
    });
    const result = response?.data?.data?.result;
    if (!Array.isArray(result)) {
      console.error("Prometheus range query error: unexpected response", {
        url: `${PROMETHEUS_URL}/api/v1/query_range`,
        query,
        data: response?.data,
      });
      return [];
    }
    return result;
  } catch (error) {
    console.error("Prometheus range query error:", error);
    return [];
  }
}

// Detection anomalies using PromQL
export async function detectAnomalies(): Promise<AnomalyAlert[]> {
  const anomalies: AnomalyAlert[] = [];

  try {
    // High error rate (> 5%)
    const errorRateResults = await queryFirstNonEmpty([
      'sum(rate(http_requests_total{status=~"5.."}[5m])) by (job) / sum(rate(http_requests_total[5m])) by (job) > 0.05',
      'sum(rate(grpc_requests_total{status!="OK"}[5m])) by (grpc_service) > 0.05',
    ]);
    errorRateResults.forEach((result: PrometheusMetric) => {
      anomalies.push({
        service: pickServiceLabel(result.metric),
        severity: "CRITICAL",
        metric: "Error Rate",
        baseline: "< 5%",
        current: `${(parseFloat(result.value[1]) * 100).toFixed(2)}%`,
        description: "High error rate detected",
        timestamp: new Date(),
      });
    });
  } catch (error) {
    console.error("Error fetching error rate metrics:", error);
  }

  try {
    // High request count (indicating load)
    const requestCountResults = await queryFirstNonEmpty([
      "sum(rate(http_requests_total[5m])) by (job) > 100",
      "sum(rate(grpc_requests_total[5m])) by (grpc_service) > 100",
    ]);
    requestCountResults.forEach((result: PrometheusMetric) => {
      anomalies.push({
        service: pickServiceLabel(result.metric),
        severity: "WARNING",
        metric: "High Request Rate",
        baseline: "< 100 req/s",
        current: `${parseFloat(result.value[1]).toFixed(2)} req/s`,
        description: "High request throughput detected",
        timestamp: new Date(),
      });
    });
  } catch (error) {
    console.error("Error fetching request count metrics:", error);
  }

  try {
    // High latency (> 1s)
    const latencyResults = await queryFirstNonEmpty([
      "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, job)) > 1",
      "histogram_quantile(0.95, sum(rate(grpc_request_duration_seconds_bucket[5m])) by (le, grpc_service)) > 1",
    ]);
    latencyResults.forEach((result: PrometheusMetric) => {
      anomalies.push({
        service: pickServiceLabel(result.metric),
        severity: "WARNING",
        metric: "Response Time",
        baseline: "< 1s",
        current: `${(parseFloat(result.value[1]) * 1000).toFixed(0)}ms`,
        description: "High request latency detected",
        timestamp: new Date(),
      });
    });
  } catch (error) {
    console.error("Error fetching latency metrics:", error);
  }

  try {
    // Target down
    const downResults = await queryPrometheus("up == 0");
    downResults.forEach((result: PrometheusMetric) => {
      anomalies.push({
        service: pickServiceLabel(result.metric),
        severity: "CRITICAL",
        metric: "Target Availability",
        baseline: "up == 1",
        current: "down",
        description: "Prometheus target is down",
        timestamp: new Date(),
      });
    });
  } catch (error) {
    console.error("Error fetching target availability:", error);
  }

  if (anomalies.length === 0) {
    anomalies.push({
      service: "prometheus",
      severity: "WARNING",
      metric: "No Data",
      baseline: "metrics available",
      current: "no matching series",
      description:
        "No matching metrics for configured queries. Using microservices demo data.",
      timestamp: new Date(),
    });
  }

  return anomalies;
}

export async function getContainerHealthMetrics(): Promise<
  ContainerHealthMetric[]
> {
  const metrics: Record<string, ContainerHealthMetric> = {};

  // First, get all services that are up (even if they don't expose metrics)
  const upResults = await queryPrometheus("up");
  upResults.forEach((result: PrometheusMetric) => {
    const serviceName = pickServiceLabel(result.metric);
    const key = `default/${serviceName}/${serviceName}`;
    const isUp = parseFloat(result.value[1]) === 1;

    if (!metrics[key]) {
      metrics[key] = {
        key,
        namespace: "default",
        pod: serviceName,
        container: serviceName,
        cpuCores: 0,
        memoryBytes: 0,
        networkRxBytesPerSec: 0,
        networkTxBytesPerSec: 0,
        diskReadBytesPerSec: 0,
        diskWriteBytesPerSec: 0,
        latencyP95Ms: null,
      };
    }
  });

  // Get HTTP request metrics for services that expose them
  const requestRateResults = await queryFirstNonEmpty([
    "sum(rate(http_requests_total[5m])) by (job)",
    "sum(rate(grpc_requests_total[5m])) by (grpc_service)",
  ]);

  requestRateResults.forEach((result: PrometheusMetric) => {
    const serviceName = pickServiceLabel(result.metric);
    const key = `default/${serviceName}/${serviceName}`;
    const requestRate = parseFloat(result.value[1]);

    if (metrics[key]) {
      metrics[key].cpuCores = requestRate;
    }
  });

  // Get error rates (as percentage)
  const errorRateResults = await queryFirstNonEmpty([
    'sum(rate(http_requests_total{status=~"5.."}[5m])) by (job) / sum(rate(http_requests_total[5m])) by (job) * 100',
    'sum(rate(grpc_requests_total{status!="OK"}[5m])) by (grpc_service) / sum(rate(grpc_requests_total[5m])) by (grpc_service) * 100',
  ]);

  errorRateResults.forEach((result: PrometheusMetric) => {
    const serviceName = pickServiceLabel(result.metric);
    const key = `default/${serviceName}/${serviceName}`;
    if (metrics[key]) {
      metrics[key].memoryBytes = parseFloat(result.value[1]);
    }
  });

  // Get latency metrics
  const latencyResults = await queryFirstNonEmpty([
    "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, job))",
    "histogram_quantile(0.95, sum(rate(grpc_request_duration_seconds_bucket[5m])) by (le, grpc_service))",
  ]);

  const latencyP95Ms = latencyResults.length
    ? parseFloat(latencyResults[0].value[1]) * 1000
    : null;

  Object.values(metrics).forEach((item) => {
    item.latencyP95Ms = latencyP95Ms;
  });

  return Object.values(metrics)
    .sort((a, b) => b.cpuCores - a.cpuCores)
    .slice(0, 20);
}
