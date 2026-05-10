/**
 * Docker Application Scope Engine
 *
 * Determines which containers belong to a named application using a
 * four-tier ownership hierarchy (highest → lowest confidence):
 *
 *   1. backtrack-label    — com.backtrack.io/app label explicitly set
 *   2. compose-project    — com.docker.compose.project matches app name
 *   3. network-membership — containers share a named Docker network
 *   4. name-match         — container / image name substring match
 *
 * The engine NEVER falls back silently: if confidence is low it always
 * returns a warning so the caller can surface it to the user.
 */

import { runCommand } from "@/lib/command";
import type { DiscoveredService, OwnershipStrategy } from "@/lib/monitoring-types";

// ── Internal types ────────────────────────────────────────────────────────────

type DockerInspectNetwork = {
  NetworkID?: string;
  Aliases?: string[];
};

type DockerInspect = {
  Id: string;
  Name: string;
  State?: { Status?: string };
  Config?: { Image?: string; Env?: string[]; Labels?: Record<string, string> };
  NetworkSettings?: {
    Networks?: Record<string, DockerInspectNetwork>;
    Ports?: Record<string, Array<{ HostPort?: string }> | null>;
  };
  HostConfig?: {
    NetworkMode?: string;
    PortBindings?: Record<string, Array<{ HostPort?: string }>>;
    Binds?: string[];
  };
};

export type ContainerMetadata = {
  id: string;
  name: string;        // human-readable (no leading slash)
  image: string;
  state: string;       // "running" | "exited" | "paused" | …
  labels: Record<string, string>;
  networks: string[];  // network names (not IDs) this container is attached to
  ports: string[];     // "hostPort:containerPort" strings
};

export type DiscoveryMatch = {
  containers: ContainerMetadata[];
  strategy: OwnershipStrategy;
  confidence: "high" | "medium" | "low";
  projectKey: string;   // canonical group identifier used for deduplication
  warning?: string;
  availableNames?: string[];
};

// ── Label constants ───────────────────────────────────────────────────────────

const BACKTRACK_APP_LABEL = "com.backtrack.io/app";
const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";
const COMPOSE_SERVICE_LABEL = "com.docker.compose.service";

// System / infra networks that are never considered "application networks".
const SYSTEM_NETWORKS = new Set([
  "bridge",
  "host",
  "none",
  "ingress",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

export function normalizeAppName(name: string): string {
  return name.toLowerCase().trim().replace(/[\s_]+/g, "-");
}

function extractPorts(inspect: DockerInspect): string[] {
  const ports: string[] = [];
  const bindings = inspect.HostConfig?.PortBindings ?? {};
  for (const [containerPort, hostBindings] of Object.entries(bindings)) {
    for (const b of hostBindings ?? []) {
      if (b.HostPort) {
        ports.push(`${b.HostPort}:${containerPort.replace(/\/tcp$/, "")}`);
      }
    }
  }
  // Fall back to NetworkSettings.Ports if HostConfig bindings are empty
  if (ports.length === 0) {
    const netPorts = inspect.NetworkSettings?.Ports ?? {};
    for (const [containerPort, hostBindings] of Object.entries(netPorts)) {
      for (const b of hostBindings ?? []) {
        if (b?.HostPort) {
          ports.push(`${b.HostPort}:${containerPort.replace(/\/tcp$/, "")}`);
        }
      }
    }
  }
  return ports;
}

function parseInspected(raw: DockerInspect): ContainerMetadata {
  const networks = Object.keys(raw.NetworkSettings?.Networks ?? {}).filter(
    (n) => !SYSTEM_NETWORKS.has(n),
  );
  return {
    id: raw.Id,
    name: (raw.Name ?? "").replace(/^\//, ""),
    image: raw.Config?.Image ?? "",
    state: (raw.State?.Status ?? "unknown").toLowerCase(),
    labels: raw.Config?.Labels ?? {},
    networks,
    ports: extractPorts(raw),
  };
}

// ── Core data fetching ────────────────────────────────────────────────────────

/**
 * Returns full metadata for every running container on the Docker host.
 * Uses `docker inspect` for accuracy (labels + networks unavailable in `docker ps`).
 */
export async function fetchAllContainerMetadata(): Promise<ContainerMetadata[]> {
  const psResult = await runCommand("docker", [
    "ps",
    "--format",
    "{{.ID}}",
  ]);

  if (psResult.code !== 0) {
    throw new Error(`docker ps failed: ${psResult.stderr || "unknown error"}`);
  }

  const ids = psResult.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (ids.length === 0) return [];

  const inspectResult = await runCommand("docker", ["inspect", ...ids]);
  if (inspectResult.code !== 0) {
    throw new Error(`docker inspect failed: ${inspectResult.stderr || "unknown error"}`);
  }

  const parsed = JSON.parse(inspectResult.stdout) as DockerInspect[];
  return parsed.map(parseInspected);
}

// ── Ownership detection strategies ───────────────────────────────────────────

/** Strategy 1: Explicit backtrack label — highest confidence. */
function matchByBacktrackLabel(
  containers: ContainerMetadata[],
  norm: string,
): ContainerMetadata[] {
  return containers.filter(
    (c) => (c.labels[BACKTRACK_APP_LABEL] ?? "").toLowerCase() === norm,
  );
}

/** Strategy 2: Docker Compose project name — exact then partial. */
function matchByComposeProject(
  containers: ContainerMetadata[],
  norm: string,
): { exact: ContainerMetadata[]; partial: ContainerMetadata[] } {
  const exact = containers.filter(
    (c) => (c.labels[COMPOSE_PROJECT_LABEL] ?? "").toLowerCase() === norm,
  );
  const partial = containers.filter((c) => {
    const proj = (c.labels[COMPOSE_PROJECT_LABEL] ?? "").toLowerCase();
    return proj && proj !== norm && (proj.includes(norm) || norm.includes(proj));
  });
  return { exact, partial };
}

/**
 * Strategy 3: Network membership.
 *
 * Finds containers that share a custom Docker network whose name contains
 * the app name. Then expands to all containers on those networks — because
 * microservice stacks share one network but individual services may not
 * have app-specific names.
 *
 * Risk: Shared infrastructure networks (e.g. "monitoring") can span multiple
 * apps. We mitigate by requiring the network name itself to contain the app
 * identifier, not just any shared network.
 */
function matchByNetworkMembership(
  containers: ContainerMetadata[],
  norm: string,
): ContainerMetadata[] {
  // Find networks whose name includes the app identifier
  const appNetworks = new Set<string>();
  for (const c of containers) {
    for (const network of c.networks) {
      if (network.toLowerCase().includes(norm)) {
        appNetworks.add(network);
      }
    }
  }

  if (appNetworks.size === 0) return [];

  // Expand: every container on at least one of those networks
  return containers.filter((c) =>
    c.networks.some((n) => appNetworks.has(n)),
  );
}

/** Strategy 4: Name / image substring — lowest confidence. */
function matchByNameOrImage(
  containers: ContainerMetadata[],
  norm: string,
): ContainerMetadata[] {
  return containers.filter(
    (c) =>
      c.name.toLowerCase().includes(norm) ||
      c.image.toLowerCase().includes(norm),
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolves which containers belong to `appName` using the ownership hierarchy.
 *
 * The returned `DiscoveryMatch` includes the strategy used and a confidence
 * rating so callers can decide whether to warn the user.
 */
export async function resolveApplicationScope(
  appName: string,
): Promise<DiscoveryMatch> {
  const norm = normalizeAppName(appName);
  const allContainers = await fetchAllContainerMetadata();

  // ── Strategy 1: backtrack label ──────────────────────────────────────────
  const backtrackMatches = matchByBacktrackLabel(allContainers, norm);
  if (backtrackMatches.length > 0) {
    return {
      containers: backtrackMatches,
      strategy: "backtrack-label",
      confidence: "high",
      projectKey: `docker:${norm}`,
    };
  }

  // ── Strategy 2a: exact compose project match ─────────────────────────────
  const { exact: composeExact, partial: composePartial } =
    matchByComposeProject(allContainers, norm);

  if (composeExact.length > 0) {
    const normalizedDiffers = norm !== appName.toLowerCase();
    return {
      containers: composeExact,
      strategy: "compose-project",
      confidence: "high",
      projectKey: `docker:${norm}`,
      warning: normalizedDiffers
        ? `App name normalized to "${norm}" — matched ${composeExact.length} container(s).`
        : undefined,
    };
  }

  // ── Strategy 3: network membership ──────────────────────────────────────
  const networkMatches = matchByNetworkMembership(allContainers, norm);
  if (networkMatches.length > 0) {
    return {
      containers: networkMatches,
      strategy: "network-membership",
      confidence: "medium",
      projectKey: `docker:${norm}`,
      warning:
        "Ownership determined by shared Docker network — verify all containers belong to your application.",
    };
  }

  // ── Strategy 4: name / image match ──────────────────────────────────────
  const nameMatches = matchByNameOrImage(allContainers, norm);
  if (nameMatches.length > 0) {
    return {
      containers: nameMatches,
      strategy: "name-match",
      confidence: "low",
      projectKey: `docker:${norm}`,
      warning:
        "Ownership by name/image match only (low confidence). Add a com.backtrack.io/app label to your containers for reliable scoping.",
    };
  }

  // ── Strategy 2b: partial compose match (last resort) ────────────────────
  if (composePartial.length > 0) {
    return {
      containers: composePartial,
      strategy: "compose-project",
      confidence: "low",
      projectKey: `docker:${norm}`,
      warning: `No exact match — showing containers from a similarly named Compose project. Verify these are correct.`,
    };
  }

  // ── No match ─────────────────────────────────────────────────────────────
  const availableContainerNames = allContainers.map((c) => c.name).filter(Boolean);
  const availableProjects = [
    ...new Set(
      allContainers
        .map((c) => c.labels[COMPOSE_PROJECT_LABEL])
        .filter((p): p is string => !!p),
    ),
  ];

  const warning = availableProjects.length > 0
    ? `No match for "${appName}". Compose projects on this host: ${availableProjects.join(", ")} — try one of these as the Application name.`
    : `No containers found matching "${appName}".`;

  return {
    containers: [],
    strategy: "orphan",
    confidence: "low",
    projectKey: `docker:${norm}`,
    warning,
    availableNames: [...availableProjects, ...availableContainerNames],
  };
}

/**
 * Converts a `ContainerMetadata` object to the `DiscoveredService` shape
 * expected by the rest of BackTrack. Preserves ownership evidence on the
 * service so the dashboard and rollback engine can use it.
 */
export function containerToService(
  container: ContainerMetadata,
  strategy: OwnershipStrategy,
  confidence: "high" | "medium" | "low",
): DiscoveredService {
  const composeProject = container.labels[COMPOSE_PROJECT_LABEL];
  const composeSvc = container.labels[COMPOSE_SERVICE_LABEL];

  return {
    // Prefer the Compose service name over the full container name because it
    // is stable across `docker compose up` recreations.
    name: composeSvc || container.name,
    status: container.state === "running" ? "running" : "unknown",
    ports: container.ports,
    image: container.image,
    source: "docker",
    containerId: container.id,
    ownershipStrategy: strategy,
    ownershipConfidence: confidence,
    composeProject,
    dockerNetworks: container.networks,
  };
}

/**
 * Validates that a container name belongs to the set of containers tracked
 * by a connection. Used by the rollback engine to prevent cross-app operations.
 *
 * Checks both the compose service name AND the full container name so that
 * either form of address is accepted.
 */
export function isServiceInScope(
  serviceName: string,
  scopedServices: DiscoveredService[],
): boolean {
  const norm = serviceName.toLowerCase();
  return scopedServices.some(
    (s) =>
      s.name.toLowerCase() === norm ||
      (s.containerId && s.containerId.startsWith(norm)),
  );
}

/**
 * Groups all running containers by application ownership.
 * Used to provide a host-level view of what's running and who owns it.
 * Useful for the future "all applications" dashboard view.
 */
export async function discoverAllApplicationGroups(): Promise<
  Map<string, { strategy: OwnershipStrategy; containers: ContainerMetadata[] }>
> {
  const allContainers = await fetchAllContainerMetadata();
  const groups = new Map<
    string,
    { strategy: OwnershipStrategy; containers: ContainerMetadata[] }
  >();

  for (const c of allContainers) {
    // Backtrack label takes absolute precedence
    const btLabel = c.labels[BACKTRACK_APP_LABEL];
    if (btLabel) {
      const key = `bt:${btLabel.toLowerCase()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.containers.push(c);
      } else {
        groups.set(key, { strategy: "backtrack-label", containers: [c] });
      }
      continue;
    }

    // Compose project
    const composeProject = c.labels[COMPOSE_PROJECT_LABEL];
    if (composeProject) {
      const key = `compose:${composeProject.toLowerCase()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.containers.push(c);
      } else {
        groups.set(key, { strategy: "compose-project", containers: [c] });
      }
      continue;
    }

    // Orphan — no group affiliation
    const key = `orphan:${c.name}`;
    groups.set(key, { strategy: "orphan", containers: [c] });
  }

  return groups;
}
