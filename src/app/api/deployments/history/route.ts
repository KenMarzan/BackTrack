import { NextRequest, NextResponse } from "next/server";
import { getConnection, listConnections } from "@/lib/monitoring-store";
import { runCommand } from "@/lib/command";

type GitHubCommit = {
  sha: string;
  html_url: string;
  commit?: {
    message?: string;
    author?: {
      date?: string;
    };
  };
};

type RolloutVersion = {
  version: string;
  revision?: number;
  status: "Current" | "Available";
  source: "kubernetes" | "github";
  time: string;
  message: string;
  link?: string;
};

type DeploymentHistoryItem = {
  name: string;
  namespace: string;
  status: "Success" | "Unknown";
  deployment: string;
  currentVersion: string;
  deployedTime: string;
  source: string;
  versions: RolloutVersion[];
  versionCount: number;
  commitCount: number;
};


function formatRelativeTime(value?: string) {
  if (!value) return "unknown";
  const inputDate = new Date(value);
  if (Number.isNaN(inputDate.getTime())) return "unknown";

  const deltaSeconds = Math.floor((Date.now() - inputDate.getTime()) / 1000);
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

function parseRevisionRows(raw: string) {
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const rows: Array<{ revision: number; cause: string }> = [];

  for (const line of lines) {
    if (!/^\d+\s+/.test(line)) continue;
    const parts = line.split(/\s+/, 2);
    const revision = Number(parts[0]);
    const cause = line.slice(parts[0].length).trim();

    if (Number.isFinite(revision)) {
      rows.push({ revision, cause: cause || "No change-cause" });
    }
  }

  return rows;
}

async function fetchGitHubCommits(repo: string, branch: string) {
  const token = process.env.GITHUB_TOKEN;
  const allCommits: GitHubCommit[] = [];

  for (let page = 1; page <= 5; page += 1) {
    const url = new URL(`https://api.github.com/repos/${repo}/commits`);
    url.searchParams.set("sha", branch || "main");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: "no-store",
      });

      if (!response.ok) {
        break;
      }

      const payload = (await response.json()) as GitHubCommit[];
      if (!Array.isArray(payload) || payload.length === 0) {
        break;
      }

      allCommits.push(...payload);

      if (payload.length < 100) {
        break;
      }
    } catch {
      break;
    }
  }

  return allCommits;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get("connectionId");

  const chosenConnection = connectionId
    ? getConnection(connectionId)
    : listConnections().find((connection) => connection.platform === "kubernetes") ?? null;

  if (!chosenConnection) {
    return NextResponse.json({ deployments: [], warning: "No connection available." });
  }

  const namespace = chosenConnection.namespace || "default";
  const services = chosenConnection.discoveredServices || [];
  const repo = chosenConnection.githubRepo || "";
  const branch = chosenConnection.githubBranch || "main";

  const commits = repo ? await fetchGitHubCommits(repo, branch) : [];

  const settled = await Promise.all(
    services.map(async (service) => {
      const serviceName = service.name;
      const [deploymentJsonResult, historyResult] = await Promise.all([
        runCommand("kubectl", ["get", "deployment", serviceName, "-n", namespace, "-o", "json"]),
        runCommand("kubectl", ["rollout", "history", `deployment/${serviceName}`, "-n", namespace]),
      ]);
      return { serviceName, deploymentJsonResult, historyResult };
    }),
  );

  const deployments: DeploymentHistoryItem[] = [];

  for (const { serviceName, deploymentJsonResult, historyResult } of settled) {
    if (deploymentJsonResult.code !== 0) {
      continue;
    }

    let currentRevision = 0;
    let replicas = "0/0";
    let deployedTime = "unknown";

    try {
      const parsed = JSON.parse(deploymentJsonResult.stdout) as {
        metadata?: {
          creationTimestamp?: string;
          annotations?: Record<string, string>;
        };
        status?: {
          availableReplicas?: number;
          replicas?: number;
        };
      };

      currentRevision = Number(
        parsed.metadata?.annotations?.["deployment.kubernetes.io/revision"] || "0",
      );
      const available = parsed.status?.availableReplicas ?? 0;
      const total = parsed.status?.replicas ?? 0;
      replicas = `${available}/${total}`;
      deployedTime = formatRelativeTime(parsed.metadata?.creationTimestamp);
    } catch {
      currentRevision = 0;
    }

    const revisions = historyResult.code === 0 ? parseRevisionRows(historyResult.stdout) : [];

    const k8sVersions: RolloutVersion[] = revisions
      .sort((a, b) => b.revision - a.revision)
      .map((row) => ({
        version: `rev-${row.revision}`,
        revision: row.revision,
        status: row.revision === currentRevision ? "Current" : "Available",
        source: "kubernetes" as const,
        time: "k8s rollout",
        message: row.cause,
      }));

    const serviceNeedle = serviceName.toLowerCase().replaceAll("-", "");
    const githubVersions: RolloutVersion[] = commits
      .filter((commit) => {
        const message = (commit.commit?.message || "").toLowerCase().replaceAll("-", "");
        return message.includes(serviceNeedle);
      })
      .map((commit) => ({
        version: commit.sha.slice(0, 7),
        status: "Available" as const,
        source: "github" as const,
        time: formatRelativeTime(commit.commit?.author?.date),
        message: commit.commit?.message?.split("\n")[0] || "GitHub commit",
        link: commit.html_url,
      }));

    const merged = [...k8sVersions, ...githubVersions];

    deployments.push({
      name: serviceName,
      namespace,
      status: "Success",
      deployment: replicas,
      currentVersion: currentRevision > 0 ? `rev-${currentRevision}` : "unknown",
      deployedTime,
      source: repo ? `github/${repo}` : "kubernetes",
      versions: merged,
      versionCount: k8sVersions.length,
      commitCount: githubVersions.length,
    });
  }

  return NextResponse.json({
    connectionId: chosenConnection.id,
    namespace,
    githubRepo: repo || null,
    deployments,
  });
}
