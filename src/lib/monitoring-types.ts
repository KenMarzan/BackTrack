export type PlatformType = "kubernetes" | "docker";
export type ArchitectureType = "monolith" | "microservices";

export interface DiscoveredService {
  name: string;
  namespace?: string;
  status: "running" | "down" | "unknown";
  ports: string[];
  image?: string;
  source: "kubernetes" | "docker";
}

export interface AppConnectionInput {
  appName: string;
  platform: PlatformType;
  architecture: ArchitectureType;
  clusterName: string;
  namespace: string;
  apiServerEndpoint: string;
  prometheusUrl: string;
  authToken?: string;
  discoveredServices: DiscoveredService[];
}

export interface AppConnection extends AppConnectionInput {
  id: string;
  createdAt: string;
  status: "connected" | "error";
}