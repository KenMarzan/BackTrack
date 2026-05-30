export type PlatformType = "kubernetes" | "docker";
export type ArchitectureType = "monolith" | "microservices";

// How container ownership was determined — ordered from highest to lowest confidence.
export type OwnershipStrategy =
  | "backtrack-label"    // com.backtrack.io/app label — explicit opt-in
  | "compose-project"    // com.docker.compose.project exact match
  | "network-membership" // all containers share a custom Docker network
  | "name-match"         // container/image name substring match — low confidence
  | "orphan";            // could not determine ownership

export interface DiscoveredService {
  name: string;
  namespace?: string;
  status: "running" | "down" | "unknown";
  ports: string[];
  image?: string;
  source: "kubernetes" | "docker";
  // Docker-specific ownership metadata (absent for Kubernetes services)
  containerId?: string;
  ownershipStrategy?: OwnershipStrategy;
  ownershipConfidence?: "high" | "medium" | "low";
  composeProject?: string;
  dockerNetworks?: string[];
}

export interface AppConnectionInput {
  appName: string;
  platform: PlatformType;
  architecture: ArchitectureType;
  clusterName: string;
  namespace: string;
  apiServerEndpoint: string;
  prometheusUrl?: string;
  authToken?: string;
  githubRepo?: string;
  githubBranch?: string;
  githubToken?: string;
  discoveredServices: DiscoveredService[];
  // Canonical scope identifier — used to deduplicate without colliding across apps.
  // Docker: "<platform>:<normalizedAppName>", Kubernetes: "<platform>:<namespace>:<normalizedAppName>"
  scopeKey?: string;
  // For Docker only: the ownership strategy that determined this connection's containers.
  dockerOwnershipStrategy?: OwnershipStrategy;
}

export interface AppConnection extends AppConnectionInput {
  id: string;
  createdAt: string;
  status: "connected" | "error";
}

export type DashboardService = {
  id: string;
  connectionId: string;
  name: string;
  namespace: string;
  platform: PlatformType;
  status: "running" | "down" | "unknown";
  cpuCores: number;
  memoryMiB: number;
  requestRate: number;
  ports: string[];
  netRxMB?: number;
  netTxMB?: number;
};

export type CICDCommit = {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  timestamp: string;
  url: string;
};

export type CICDWorkflowRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  branch: string;
  triggeredBy: string;
  startedAt: string;
  url: string;
};

export type CICDImageTag = {
  tag: string;
  pushedAt: string;
  pullUrl: string;
};

export type CICDData = {
  repo: string;
  branch: string;
  commits: CICDCommit[];
  workflowRuns: CICDWorkflowRun[];
  imageTags: CICDImageTag[];
  fetchedAt: string;
  warning?: string;
};

export type DashboardAnomaly = {
  id: string;
  service: string;
  namespace: string;
  platform?: PlatformType;
  severity: "critical" | "high" | "warning";
  message: string;
  metric: string;
  current: string;
  baseline: string;
  detectedAt?: string;
  autoRollback?: boolean;
};