import { NextResponse } from "next/server";
import { listConnections } from "@/lib/monitoring-store";
import { runCommand } from "@/lib/command";
import type { DashboardService, DashboardAnomaly } from "@/lib/monitoring-types";

type RawConnection = {
	id: string;
	appName?: string;
	name?: string;
	platform?: "kubernetes" | "docker";
	kind?: "kubernetes" | "docker";
	namespace?: string;
	workload?: string;
	prometheusUrl?: string;
	authToken?: string;
	discoveredServices?: Array<{
		name?: string;
		namespace?: string;
		status?: "running" | "down" | "unknown";
		ports?: string[];
		source?: "kubernetes" | "docker";
	}>;
};

function workloadFromService(serviceName: string) {
	return serviceName.replaceAll(".", "\\.");
}

function serviceNameRegex(serviceName: string) {
	return serviceName.toLowerCase().replaceAll(".", "-");
}

function parseCpuToCores(raw: string) {
	const value = raw.trim().toLowerCase();
	if (!value) return 0;
	if (value.endsWith("m")) {
		const milli = Number(value.slice(0, -1));
		return Number.isFinite(milli) ? milli / 1000 : 0;
	}

	const cores = Number(value);
	return Number.isFinite(cores) ? cores : 0;
}

function parseMemoryToMiB(raw: string) {
	const value = raw.trim();
	const match = value.match(/^([0-9]+(?:\.[0-9]+)?)(Ki|Mi|Gi|Ti|K|M|G|T)?$/i);
	if (!match) return 0;

	const amount = Number(match[1]);
	if (!Number.isFinite(amount)) return 0;

	const unit = (match[2] || "Mi").toLowerCase();
	if (unit === "ki" || unit === "k") return amount / 1024;
	if (unit === "mi" || unit === "m") return amount;
	if (unit === "gi" || unit === "g") return amount * 1024;
	if (unit === "ti" || unit === "t") return amount * 1024 * 1024;

	return amount;
}


async function getKubectlTopByService(namespace: string, services: string[]) {
	const result = await runCommand("kubectl", [
		"top",
		"pods",
		"-n",
		namespace,
		"--no-headers",
	]);

	if (result.code !== 0) {
		return new Map<string, { cpuCores: number; memoryMiB: number }>();
	}

	const lines = result.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	const rows = lines
		.map((line) => line.split(/\s+/))
		.filter((parts) => parts.length >= 3)
		.map((parts) => ({
			podName: parts[0].toLowerCase(),
			cpuCores: parseCpuToCores(parts[1]),
			memoryMiB: parseMemoryToMiB(parts[2]),
		}));

	const metrics = new Map<string, { cpuCores: number; memoryMiB: number }>();

	for (const serviceName of services) {
		const needle = serviceNameRegex(serviceName);
		const matched = rows.filter((row) => row.podName.includes(needle));

		metrics.set(serviceName, {
			cpuCores: matched.reduce((sum, row) => sum + row.cpuCores, 0),
			memoryMiB: matched.reduce((sum, row) => sum + row.memoryMiB, 0),
		});
	}

	return metrics;
}

function normalizeConnectionServices(connection: RawConnection) {
	if (Array.isArray(connection.discoveredServices) && connection.discoveredServices.length > 0) {
		return connection.discoveredServices.map((service) => ({
			name: service.name || connection.appName || connection.name || "unknown-service",
			namespace: service.namespace || connection.namespace || "default",
			status: service.status || "unknown",
			ports: Array.isArray(service.ports) ? service.ports : [],
			source: service.source || (connection.platform || connection.kind || "kubernetes"),
		}));
	}

	const workload = connection.workload || "";
	const fallbackName = workload.includes("/")
		? workload.split("/")[1]
		: connection.appName || connection.name || "unknown-service";

	return [
		{
			name: fallbackName,
			namespace: connection.namespace || "default",
			status: "unknown" as const,
			ports: [] as string[],
			source: (connection.platform || connection.kind || "kubernetes") as "kubernetes" | "docker",
		},
	];
}

async function queryScalarOptional(
	baseUrl: string,
	query: string,
	authToken?: string,
) {
	try {
		const url = new URL("/api/v1/query", baseUrl);
		url.searchParams.set("query", query);

		const response = await fetch(url, {
			headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
			cache: "no-store",
		});

		if (!response.ok) {
			return null;
		}

		const payload = (await response.json()) as {
			data?: { result?: Array<{ value?: [number, string] }> };
		};

		const value = payload.data?.result?.[0]?.value?.[1];
		if (value === undefined) {
			return null;
		}

		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

async function queryFirstScalar(
	baseUrl: string,
	queries: string[],
	authToken?: string,
) {
	for (const query of queries) {
		const value = await queryScalarOptional(baseUrl, query, authToken);
		if (value !== null) {
			return value;
		}
	}

	return 0;
}

export async function GET() {
	const connections = listConnections() as RawConnection[];
	const services: DashboardService[] = [];

	for (const connection of connections) {
		const connectionPlatform = (connection.platform || connection.kind || "kubernetes") as "kubernetes" | "docker";
		const connectionNamespace = connection.namespace || "default";
		const normalizedServices = normalizeConnectionServices(connection);
		const kubectlTopByService = connectionPlatform === "kubernetes"
			? await getKubectlTopByService(
				connectionNamespace,
				normalizedServices.map((service) => service.name),
			)
			: new Map<string, { cpuCores: number; memoryMiB: number }>();

		for (const service of normalizedServices) {
			if (connectionPlatform === "docker") {
				services.push({
					id: `${connection.id}:${service.name}`,
					connectionId: connection.id,
					name: service.name,
					namespace: connectionNamespace,
					platform: "docker",
					status: service.status,
					cpuCores: 0,
					memoryMiB: 0,
					requestRate: 0,
					ports: service.ports,
				});
				continue;
			}

			const svcName = workloadFromService(service.name);
			const podRegex = `${svcName}-.*|.*${svcName}.*`;
			const ns = connectionNamespace;
			const prometheusUrl = connection.prometheusUrl || "";

			if (!prometheusUrl) {
				services.push({
					id: `${connection.id}:${service.name}`,
					connectionId: connection.id,
					name: service.name,
					namespace: ns,
					platform: "kubernetes",
					status: "unknown",
					cpuCores: 0,
					memoryMiB: 0,
					requestRate: 0,
					ports: service.ports,
				});
				continue;
			}

			const [podUp, tcpProbe, cpu, memoryBytes, requestRate] = await Promise.all([
				queryScalarOptional(
					prometheusUrl,
					`max(up{job="kubernetes-pods",kubernetes_namespace="${ns}",kubernetes_pod_name=~"${svcName}-.*"} or up{job="kubernetes-pods",kubernetes_namespace="${ns}",app="${service.name}"})`,
					connection.authToken,
				),
				queryScalarOptional(
					prometheusUrl,
					`max(probe_success{job="kubernetes-services-tcp",kubernetes_namespace="${ns}",service="${service.name}"})`,
					connection.authToken,
				),
				queryFirstScalar(
					prometheusUrl,
					[
						`sum(rate(container_cpu_usage_seconds_total{namespace="${ns}",pod=~"${podRegex}",container!="POD"}[5m]))`,
						`sum(rate(container_cpu_usage_seconds_total{kubernetes_namespace="${ns}",pod_name=~"${podRegex}",container_name!="POD"}[5m]))`,
						`sum(node_namespace_pod_container:container_cpu_usage_seconds_total:sum_irate{namespace="${ns}",pod=~"${podRegex}"})`,
						`sum(rate(process_cpu_seconds_total{kubernetes_namespace="${ns}",pod=~"${podRegex}"}[5m]))`,
						`sum(rate(process_cpu_seconds_total{namespace="${ns}",pod=~"${podRegex}"}[5m]))`,
					],
					connection.authToken,
				),
				queryFirstScalar(
					prometheusUrl,
					[
						`sum(container_memory_working_set_bytes{namespace="${ns}",pod=~"${podRegex}",container!="POD"})`,
						`sum(container_memory_working_set_bytes{kubernetes_namespace="${ns}",pod_name=~"${podRegex}",container_name!="POD"})`,
						`sum(node_namespace_pod_container:container_memory_working_set_bytes{namespace="${ns}",pod=~"${podRegex}"})`,
						`sum(process_resident_memory_bytes{kubernetes_namespace="${ns}",pod=~"${podRegex}"})`,
						`sum(process_resident_memory_bytes{namespace="${ns}",pod=~"${podRegex}"})`,
					],
					connection.authToken,
				),
				queryFirstScalar(
					prometheusUrl,
					[
						`sum(rate(http_requests_total{kubernetes_namespace="${ns}",app="${service.name}"}[5m]))`,
						`sum(rate(http_server_requests_seconds_count{kubernetes_namespace="${ns}",app="${service.name}"}[5m]))`,
						`sum(rate(http_requests_total{namespace="${ns}",service="${service.name}"}[5m]))`,
					],
					connection.authToken,
				),
			]);

			const fallbackUsage = kubectlTopByService.get(service.name);
			const cpuFinal = cpu > 0 ? cpu : (fallbackUsage?.cpuCores ?? 0);
			const memoryMiBFinal = memoryBytes > 0
				? memoryBytes / 1024 / 1024
				: (fallbackUsage?.memoryMiB ?? 0);

			let status: "running" | "down" | "unknown" = "unknown";
			const observedValues = [podUp, tcpProbe].filter(
				(value): value is number => value !== null,
			);

			if (observedValues.length > 0) {
				status = observedValues.some((value) => value >= 1) ? "running" : "down";
			}

			services.push({
				id: `${connection.id}:${service.name}`,
				connectionId: connection.id,
				name: service.name,
				namespace: ns,
				platform: "kubernetes",
				status,
				cpuCores: cpuFinal,
				memoryMiB: memoryMiBFinal,
				requestRate,
				ports: service.ports,
			});
		}
	}

	const anomalies: DashboardAnomaly[] = services
		.flatMap((service) => {
			const issues: DashboardAnomaly[] = [];

			if (service.status === "down") {
				issues.push({
					id: `${service.id}-down`,
					service: service.name,
					namespace: service.namespace,
					severity: "critical",
					message: "Service scrape status is down.",
					metric: "up",
					baseline: "1",
					current: "0",
				});
			}

			if (service.memoryMiB > 120) {
				issues.push({
					id: `${service.id}-memory`,
					service: service.name,
					namespace: service.namespace,
					severity: "warning",
					message: "Memory usage above baseline threshold.",
					metric: "memory",
					baseline: "< 120 MiB",
					current: `${service.memoryMiB.toFixed(1)} MiB`,
				});
			}

			return issues;
		})
		.slice(0, 20);

	return NextResponse.json({
		generatedAt: new Date().toISOString(),
		services,
		anomalies,
	});
}
