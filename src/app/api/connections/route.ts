import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import {
	ArchitectureType,
	DiscoveredService,
	PlatformType,
} from "@/lib/monitoring-types";
import { listConnections, registerConnection } from "@/lib/monitoring-store";

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
};

function runCommand(command: string, args: string[]) {
	return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
		const child = spawn(command, args, { shell: false });
		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});

		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		child.on("error", (error) => {
			resolve({ code: 1, stdout: "", stderr: error.message });
		});

		child.on("close", (code) => {
			resolve({ code: code ?? 1, stdout, stderr });
		});
	});
}

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

	const svcJson = JSON.parse(svcResult.stdout) as {
		items: Array<{
			metadata?: { name?: string; labels?: Record<string, string> };
			spec?: { ports?: Array<{ port?: number; targetPort?: number | string }> };
		}>;
	};

	const podJson = podResult.code === 0
		? (JSON.parse(podResult.stdout) as {
				items: Array<{
					metadata?: { name?: string; labels?: Record<string, string> };
					status?: { phase?: string };
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

			const relatedPods = (podJson.items || []).filter((pod) => {
				const podName = (pod.metadata?.name || "").toLowerCase();
				const podApp = (pod.metadata?.labels?.app || "").toLowerCase();
				return podName.includes(name.toLowerCase()) || podApp === name.toLowerCase();
			});

			const isRunning = relatedPods.some((pod) => pod.status?.phase === "Running");

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
		const clusterName = (payload.clusterName || "").trim();
		const namespace = (payload.namespace || "default").trim();
		const apiServerEndpoint = (payload.apiServerEndpoint || "").trim();
		const prometheusUrl = (payload.prometheusUrl || "").trim();
		const authToken = (payload.authToken || "").trim();

		if (!appName || !clusterName || !prometheusUrl) {
			return NextResponse.json(
				{ error: "App name, cluster name, and Prometheus URL are required." },
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
