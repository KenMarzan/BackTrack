import fs from "node:fs";
import path from "node:path";
import { AppConnection, AppConnectionInput } from "./monitoring-types";

let _writeLock: Promise<void> = Promise.resolve();

const DATA_DIR = path.join(process.cwd(), ".backtrack");
const CONNECTIONS_FILE = path.join(DATA_DIR, "connections.json");

type LegacyConnection = {
	id?: string;
	status?: "connected" | "error";
	createdAt?: string;
	name?: string;
	kind?: "kubernetes" | "docker";
	workload?: string;
	appName?: string;
	platform?: "kubernetes" | "docker";
	architecture?: "monolith" | "microservices";
	clusterName?: string;
	namespace?: string;
	apiServerEndpoint?: string;
	prometheusUrl?: string;
	authToken?: string;
	githubRepo?: string;
	githubBranch?: string;
	githubToken?: string;
	discoveredServices?: Array<{
		name?: string;
		namespace?: string;
		status?: "running" | "down" | "unknown";
		ports?: string[];
		image?: string;
		source?: "kubernetes" | "docker";
	}>;
};

function normalizeConnection(connection: LegacyConnection): AppConnection {
	const appName = (connection.appName || connection.name || "unknown-app").trim();
	const platform = (connection.platform || connection.kind || "kubernetes") as
		| "kubernetes"
		| "docker";
	const namespace = (connection.namespace || "default").trim();
	const workload = (connection.workload || "deployment/unknown").trim();
	const workloadName = workload.includes("/") ? workload.split("/")[1] : workload;

	const discoveredServices =
		connection.discoveredServices && connection.discoveredServices.length > 0
			? connection.discoveredServices.map((service) => ({
					name: service.name || workloadName || appName,
					namespace: service.namespace || namespace,
					status: service.status || "unknown",
					ports: Array.isArray(service.ports) ? service.ports : [],
					image: service.image,
					source: service.source || platform,
				}))
			: [
					{
						name: workloadName || appName,
						namespace,
						status: "unknown" as const,
						ports: [],
						source: platform,
					},
				];

	return {
		id: connection.id || crypto.randomUUID(),
		status: connection.status || "connected",
		createdAt: connection.createdAt || new Date().toISOString(),
		appName,
		platform,
		architecture: connection.architecture || "microservices",
		clusterName: (connection.clusterName || "unknown-cluster").trim(),
		namespace,
		apiServerEndpoint: (connection.apiServerEndpoint || "").trim(),
		prometheusUrl: connection.prometheusUrl?.trim() || undefined,
		authToken: connection.authToken,
		githubRepo: (connection.githubRepo || "").trim() || undefined,
		githubBranch: (connection.githubBranch || "main").trim(),
		githubToken: connection.githubToken,
		discoveredServices,
	};
}

function readConnections() {
	try {
		if (!fs.existsSync(CONNECTIONS_FILE)) {
			return [] as AppConnection[];
		}
		const raw = fs.readFileSync(CONNECTIONS_FILE, "utf-8");
		const parsed = JSON.parse(raw) as LegacyConnection[];
		if (!Array.isArray(parsed)) {
			return [] as AppConnection[];
		}

		return parsed.map((item) => normalizeConnection(item));
	} catch {
		return [] as AppConnection[];
	}
}

function writeConnections(connections: AppConnection[]) {
	fs.mkdirSync(DATA_DIR, { recursive: true });
	const tmp = CONNECTIONS_FILE + ".tmp";
	fs.writeFileSync(tmp, JSON.stringify(connections, null, 2));
	fs.renameSync(tmp, CONNECTIONS_FILE);
}

function writeConnectionsQueued(connections: AppConnection[]): Promise<void> {
	_writeLock = _writeLock.then(() => writeConnections(connections)).catch(() => writeConnections(connections));
	return _writeLock;
}

export function listConnections() {
	return readConnections();
}

export function getConnection(id: string) {
	return readConnections().find((connection) => connection.id === id) ?? null;
}

export function findConnectionByNamespace(namespace: string): AppConnection | null {
	const connections = readConnections();
	return (
		connections.find((c) => (c.namespace || "default") === namespace) ??
		connections[0] ??
		null
	);
}

export function registerConnection(input: AppConnectionInput) {
	const existing = readConnections();

	// Compute the canonical scope key for deduplication.
	// Two connections with the same scopeKey are considered the same application
	// and the newer one replaces the older — regardless of platform.
	// This allows multiple Docker apps on the same host to coexist.
	const incomingScopeKey =
		input.scopeKey ??
		(input.platform === "docker"
			? `docker:${input.appName.toLowerCase().trim().replace(/[\s_]+/g, "-")}`
			: `kubernetes:${input.namespace}:${input.appName.toLowerCase().trim().replace(/[\s_]+/g, "-")}`);

	// Remove only the exact app being re-registered, not all same-platform connections.
	const surviving = existing.filter((c) => {
		const existingScopeKey =
			c.scopeKey ??
			(c.platform === "docker"
				? `docker:${c.appName.toLowerCase().trim().replace(/[\s_]+/g, "-")}`
				: `kubernetes:${c.namespace}:${c.appName.toLowerCase().trim().replace(/[\s_]+/g, "-")}`);
		return existingScopeKey !== incomingScopeKey;
	});

	const connection: AppConnection = {
		id: crypto.randomUUID(),
		status: "connected",
		createdAt: new Date().toISOString(),
		...input,
		scopeKey: incomingScopeKey,
	};

	surviving.unshift(connection);
	writeConnectionsQueued(surviving);

	return connection;
}

/** Remove a connection by ID. */
export function removeConnection(id: string): boolean {
	const existing = readConnections();
	const next = existing.filter((c) => c.id !== id);
	if (next.length === existing.length) return false;
	writeConnectionsQueued(next);
	return true;
}
