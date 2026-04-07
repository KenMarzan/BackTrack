import { NextResponse } from "next/server";
import { listConnections } from "@/lib/monitoring-store";

type DashboardService = {
	id: string;
	connectionId: string;
	name: string;
	namespace: string;
	platform: "kubernetes" | "docker";
	status: "running" | "down" | "unknown";
	cpuCores: number;
	memoryMiB: number;
	requestRate: number;
	ports: string[];
};

type DashboardAnomaly = {
	id: string;
	service: string;
	severity: "critical" | "high" | "warning";
	message: string;
	metric: string;
	current: string;
	baseline: string;
};

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

async function queryScalar(
	baseUrl: string,
	query: string,
	authToken?: string,
) {
	const value = await queryScalarOptional(baseUrl, query, authToken);
	return value ?? 0;
}

export async function GET() {
	const connections = listConnections() as RawConnection[];
	const services: DashboardService[] = [];

	for (const connection of connections) {
		const connectionPlatform = (connection.platform || connection.kind || "kubernetes") as "kubernetes" | "docker";
		const connectionNamespace = connection.namespace || "default";
		const normalizedServices = normalizeConnectionServices(connection);

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

			const podUp = await queryScalarOptional(
				prometheusUrl,
				`max(up{job="kubernetes-pods",kubernetes_namespace="${ns}",kubernetes_pod_name=~"${svcName}-.*"} or up{job="kubernetes-pods",kubernetes_namespace="${ns}",app="${service.name}"})`,
				connection.authToken,
			);

			const tcpProbe = await queryScalarOptional(
				prometheusUrl,
				`max(probe_success{job="kubernetes-services-tcp",kubernetes_namespace="${ns}",service="${service.name}"})`,
				connection.authToken,
			);

			const cpu = await queryScalar(
				prometheusUrl,
				`sum(rate(container_cpu_usage_seconds_total{namespace="${ns}",pod=~"${svcName}-.*",container!="POD",image!=""}[5m]))`,
				connection.authToken,
			);

			const memoryBytes = await queryScalar(
				prometheusUrl,
				`sum(container_memory_working_set_bytes{namespace="${ns}",pod=~"${svcName}-.*",container!="POD",image!=""})`,
				connection.authToken,
			);

			const requestRate = await queryScalar(
				prometheusUrl,
				`sum(rate(http_requests_total{kubernetes_namespace="${ns}",app="${service.name}"}[5m]))`,
				connection.authToken,
			);

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
				cpuCores: cpu,
				memoryMiB: memoryBytes / 1024 / 1024,
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
