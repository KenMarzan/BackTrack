import { NextRequest, NextResponse } from "next/server";
import {
	ArchitectureType,
	DiscoveredService,
	PlatformType,
} from "@/lib/monitoring-types";
import { listConnections, registerConnection } from "@/lib/monitoring-store";
import { runCommand } from "@/lib/command";

type ConnectionPayload = {
	action?: "test" | "connect";
	appName?: string;
	platform?: PlatformType;
	architecture?: ArchitectureType;
	clusterName?: string;
	namespace?: string;
	apiServerEndpoint?: string;
	prometheusUrl?: string;
	authToken?: string;
	githubRepo?: string;
	githubBranch?: string;
	githubToken?: string;
};

async function discoverKubernetesServices(
	namespace: string,
	architecture: ArchitectureType,
	appName: string,
) {
	const svcResult = await runCommand("kubectl", [
		"get",
		"svc",
		"-n",
		namespace,
		"-o",
		"json",
	]);

	if (svcResult.code !== 0) {
		throw new Error(
			`kubectl service discovery failed: ${svcResult.stderr || "unknown error"}`,
		);
	}

	const podResult = await runCommand("kubectl", [
		"get",
		"pods",
		"-n",
		namespace,
		"-o",
		"json",
	]);

	const endpointResult = await runCommand("kubectl", [
		"get",
		"endpoints",
		"-n",
		namespace,
		"-o",
		"json",
	]);

	const svcJson = JSON.parse(svcResult.stdout) as {
		items: Array<{
			metadata?: { name?: string; labels?: Record<string, string> };
			spec?: {
				ports?: Array<{ port?: number; targetPort?: number | string }>;
				selector?: Record<string, string>;
			};
		}>;
	};

	const podJson = podResult.code === 0
		? (JSON.parse(podResult.stdout) as {
				items: Array<{
					metadata?: { name?: string; labels?: Record<string, string> };
					status?: { phase?: string };
					spec?: { nodeName?: string };
				}>;
			})
		: { items: [] };

	const endpointJson = endpointResult.code === 0
		? (JSON.parse(endpointResult.stdout) as {
				items: Array<{
					metadata?: { name?: string };
					subsets?: Array<{
						addresses?: Array<Record<string, unknown>>;
						notReadyAddresses?: Array<Record<string, unknown>>;
					}>;
				}>;
			})
		: { items: [] };

	const appLower = appName.toLowerCase();

	return (svcJson.items || [])
		.filter((item) => {
			const name = (item.metadata?.name || "").toLowerCase();
			const appLabel = (item.metadata?.labels?.app || "").toLowerCase();

			if (architecture === "microservices") {
				return name !== "kubernetes";
			}

			return name.includes(appLower) || appLabel.includes(appLower);
		})
		.map((item): DiscoveredService => {
			const name = item.metadata?.name || "unknown-service";
			const ports = (item.spec?.ports || []).map((port) =>
				`${port.port ?? "?"}:${port.targetPort ?? "?"}`,
			);
			const selector = item.spec?.selector || {};
			const endpointItem = (endpointJson.items || []).find(
				(endpoint) => (endpoint.metadata?.name || "").toLowerCase() === name.toLowerCase(),
			);
			const readyEndpointCount = endpointItem?.subsets?.reduce(
				(sum, subset) => sum + (subset.addresses?.length || 0),
				0,
			) ?? 0;

			const serviceSelectorEntries = Object.entries(selector).map(([key, value]) => {
				return `${key}=${String(value).toLowerCase()}`;
			});

			const relatedPods = (podJson.items || []).filter((pod) => {
				const podName = (pod.metadata?.name || "").toLowerCase();
				const podLabels = Object.entries(pod.metadata?.labels || {}).map(
					([key, value]) => `${key}=${String(value).toLowerCase()}`,
				);

				const selectorMatch =
					serviceSelectorEntries.length > 0 &&
					serviceSelectorEntries.every((entry) => podLabels.includes(entry));

				return (
					podName.includes(name.toLowerCase()) ||
					String(pod.metadata?.labels?.app || "").toLowerCase() === name.toLowerCase() ||
					selectorMatch
				);
			});

			const isRunning = readyEndpointCount > 0 || relatedPods.some((pod) => pod.status?.phase === "Running");

			return {
				name,
				namespace,
				status: isRunning ? "running" : "unknown",
				ports,
				source: "kubernetes",
			};
		});
}

async function discoverDockerServices(appName: string, architecture: ArchitectureType) {
	const dockerResult = await runCommand("docker", [
		"ps",
		"--format",
		"{{json .}}",
	]);

	if (dockerResult.code !== 0) {
		throw new Error(`docker discovery failed: ${dockerResult.stderr || "unknown error"}`);
	}

	const lines = dockerResult.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	const appLower = appName.toLowerCase();

	return lines
		.map((line) => JSON.parse(line) as Record<string, string>)
		.filter((container) => {
			if (architecture === "microservices") {
				return true;
			}

			return (
				(container.Names || "").toLowerCase().includes(appLower) ||
				(container.Image || "").toLowerCase().includes(appLower)
			);
		})
		.map(
			(container): DiscoveredService => ({
				name: container.Names || "unknown-container",
				status: (container.State || "").toLowerCase() === "running" ? "running" : "unknown",
				ports: container.Ports ? [container.Ports] : [],
				image: container.Image,
				source: "docker",
			}),
		);
}

export async function GET() {
	return NextResponse.json({ connections: listConnections() });
}

export async function POST(request: NextRequest) {
	try {
		const payload = (await request.json()) as ConnectionPayload;
		const action = payload.action || "connect";
		const appName = (payload.appName || "").trim();
		const platform = (payload.platform || "kubernetes") as PlatformType;
		const architecture = (payload.architecture || "microservices") as ArchitectureType;
		const clusterName = (payload.clusterName || (platform === "docker" ? "local-docker" : "")).trim();
		const namespace = (payload.namespace || "default").trim();
		const apiServerEndpoint = (payload.apiServerEndpoint || "").trim();
		const prometheusUrl = (payload.prometheusUrl || "").trim();
		const authToken = (payload.authToken || "").trim();
		const githubRepo = (payload.githubRepo || "").trim();
		const githubBranch = (payload.githubBranch || "main").trim();
		const githubToken = (payload.githubToken || "").trim();

		if (!appName || (platform !== "docker" && !clusterName)) {
			return NextResponse.json(
				{ error: "App name and cluster name are required." },
				{ status: 400 },
			);
		}

		let discoveredServices: DiscoveredService[] = [];

		if (platform === "kubernetes") {
			discoveredServices = await discoverKubernetesServices(
				namespace,
				architecture,
				appName,
			);
		} else {
			discoveredServices = await discoverDockerServices(appName, architecture);
		}

		if (action === "test") {
			return NextResponse.json({
				ok: true,
				discoveredServices,
				message: `Discovered ${discoveredServices.length} service(s).`,
			});
		}

		const connection = registerConnection({
			appName,
			platform,
			architecture,
			clusterName,
			namespace,
			apiServerEndpoint,
			prometheusUrl,
			authToken: authToken || undefined,
			githubRepo: githubRepo || undefined,
			githubBranch,
			githubToken: githubToken || undefined,
			discoveredServices,
		});

		return NextResponse.json({
			ok: true,
			connection,
			discoveredServices,
			message: `Connected ${appName} with ${discoveredServices.length} discovered service(s).`,
		});
	} catch (error: any) {
		return NextResponse.json({ error: error.message }, { status: 500 });
	}
}
