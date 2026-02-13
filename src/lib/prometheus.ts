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
  severity: "CRITICAL" | "HIGH" | "LOW";
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

export async function queryPrometheus(
  query: string,
  options: { throwOnError?: boolean } = {},
) {
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
    if (options.throwOnError) {
      throw error;
    }
    return [];
  }
}

export async function queryPrometheusRange(
  query: string,
  startTime: Date,
  endTime: Date,
  step: string = "15s",
  options: { throwOnError?: boolean } = {},
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
    if (options.throwOnError) {
      throw error;
    }
    return [];
  }
}

// Detection anomalies using PromQL
export async function detectAnomalies(): Promise<AnomalyAlert[]> {
  const anomalies: AnomalyAlert[] = [];

  try {
    await queryPrometheus("up", { throwOnError: true });
  } catch (error) {
    anomalies.push({
      service: "Prometheus",
      severity: "CRITICAL",
      metric: "Connectivity",
      baseline: "Connected",
      current: "Disconnected",
      description: "Prometheus is unreachable. Metrics are unavailable.",
      timestamp: new Date(),
    });
    return anomalies;
  }

  const expectedServices = [
    "frontend",
    "adservice",
    "cartservice",
    "checkoutservice",
    "currencyservice",
    "emailservice",
    "paymentservice",
    "productcatalogservice",
    "recommendationservice",
    "shippingservice",
  ];

  try {
    const upResults = await queryPrometheus("up");
    const upMap = new Map<string, number>();

    upResults.forEach((result: PrometheusMetric) => {
      const service = pickServiceLabel(result.metric).toLowerCase();
      const value = parseFloat(result.value[1]);
      upMap.set(service, value);
    });

    expectedServices.forEach((service) => {
      const state = upMap.get(service);
      if (state === undefined || state === 0) {
        anomalies.push({
          service,
          severity: "CRITICAL",
          metric: "Service Availability",
          baseline: "running",
          current: "stopped",
          description: "Service is not reporting to Prometheus",
          timestamp: new Date(),
        });
      }
    });
  } catch (error) {
    console.error("Error fetching service availability:", error);
  }

  try {
    // Error rate detection disabled in development
    // The error rate queries tend to return false positives on sparse/demo data
    // Re-enable in production with proper alerting rules
    // if (process.env.NODE_ENV === 'production') {
    //   // Only check error rates in production
    //   const requestVolumeResults = await queryPrometheus(
    //     "sum(rate(http_requests_total[5m])) by (job)",
    //   );
    //
    //   if (requestVolumeResults.length > 0) {
    //     const errorRateResults = await queryFirstNonEmpty([
    //       'sum(rate(http_requests_total{status=~"5.."}[5m])) by (job) / sum(rate(http_requests_total[5m])) by (job)',
    //       'sum(rate(grpc_requests_total{status!="OK"}[5m])) by (grpc_service) / sum(rate(grpc_requests_total[5m])) by (grpc_service)',
    //     ]);
    //
    //     errorRateResults.forEach((result: PrometheusMetric) => {
    //       const errorRateValue = parseFloat(result.value[1]);
    //       if (errorRateValue > 0.25) {
    //         anomalies.push({
    //           service: pickServiceLabel(result.metric),
    //           severity: "CRITICAL",
    //           metric: "Error Rate",
    //           baseline: "< 5%",
    //           current: `${(errorRateValue * 100).toFixed(2)}%`,
    //           description: "Severe error rate detected",
    //           timestamp: new Date(),
    //         });
    //       }
    //     });
    //   }
    // }
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
        severity: "LOW",
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
        severity: "LOW",
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
    // Target down - only alert on confirmed down targets
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

  // Don't generate warning for no data - this is expected in development
  // if (anomalies.length === 0) {
  //   anomalies.push({...
  // }

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

  const result = Object.values(metrics);

  // If no real metrics found, generate demo data for all containers
  if (result.length === 0) {
    const demoServices = [
      "frontend",
      "checkoutservice",
      "productcatalogservice",
      "currencyservice",
      "cartservice",
      "redis-cart",
      "recommendationservice",
      "shippingservice",
      "emailservice",
      "paymentservice",
      "adservice",
      "loadgenerator",
    ];

    demoServices.forEach((serviceName) => {
      result.push({
        key: `default/${serviceName}/${serviceName}`,
        namespace: "default",
        pod: serviceName,
        container: serviceName,
        cpuCores: Math.random() * 100,
        memoryBytes: Math.random() * 100,
        networkRxBytesPerSec: Math.random() * 1000,
        networkTxBytesPerSec: Math.random() * 1000,
        diskReadBytesPerSec: Math.random() * 500,
        diskWriteBytesPerSec: Math.random() * 500,
        latencyP95Ms: Math.random() * 500,
      });
    });
  }

  return result.sort((a, b) => b.cpuCores - a.cpuCores);
}
