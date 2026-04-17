"use client";

import { ExternalLink, GitMerge, RotateCcw, Triangle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type DeploymentVersion = {
  version: string;
  revision?: number;
  status: "Current" | "Available";
  source: "kubernetes" | "github";
  time: string;
  message: string;
  link?: string;
};

type DeploymentItem = {
  name: string;
  namespace: string;
  status: "Success" | "Unknown";
  deployment: string;
  currentVersion: string;
  deployedTime: string;
  source: string;
  versions: DeploymentVersion[];
  versionCount: number;
  commitCount: number;
};

type HistoryResponse = {
  connectionId?: string;
  githubRepo?: string | null;
  deployments?: DeploymentItem[];
};

function RecentDeployment() {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [deployments, setDeployments] = useState<DeploymentItem[]>([]);
  const [connectionId, setConnectionId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string>("");
  const [rollingBackKey, setRollingBackKey] = useState<string>("");
  const hasLoadedRef = useRef(false);

  const loadHistory = async () => {
    if (!hasLoadedRef.current) setIsLoading(true);

    try {
      const response = await fetch("/api/deployments/history", { cache: "no-store" });
      const payload = (await response.json()) as HistoryResponse;

      if (!response.ok) {
        throw new Error("Unable to fetch deployment history.");
      }

      setConnectionId(payload.connectionId || "");
      setDeployments(Array.isArray(payload.deployments) ? payload.deployments : []);
      setMessage("");
      hasLoadedRef.current = true;
    } catch (error: any) {
      setDeployments([]);
      setMessage(error.message || "Failed to load deployment history.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();

    const refresh = () => {
      loadHistory();
    };

    const timer = window.setInterval(loadHistory, 20000);
    window.addEventListener("backtrack:connection-updated", refresh);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("backtrack:connection-updated", refresh);
    };
  }, []);

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  const rollback = async (serviceName: string, version: DeploymentVersion) => {
    if (!connectionId) {
      setMessage("No active connection for rollback.");
      return;
    }

    const label = version.revision ? `revision ${version.revision}` : version.version;
    const confirmed = window.confirm(`Rollback ${serviceName} to ${label}?`);
    if (!confirmed) return;

    const key = `${serviceName}:${label}`;
    setRollingBackKey(key);

    try {
      const response = await fetch("/api/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          service: serviceName,
          revision: version.revision,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Rollback failed.");
      }

      setMessage(`Rollback completed for ${serviceName}.`);
      loadHistory();
    } catch (error: any) {
      setMessage(error.message || "Rollback failed.");
    } finally {
      setRollingBackKey("");
    }
  };

  const successRate = useMemo(() => {
    if (deployments.length === 0) return 0;
    const successful = deployments.filter((deployment) => deployment.status === "Success").length;
    return Math.round((successful / deployments.length) * 100);
  }, [deployments]);

  return (
    <div className="col-span-1 p-6 border border-[#5D5A5A] rounded-lg h-full flex flex-col overflow-hidden">
      <div className="flex flex-row gap-2 justify-between mb-4 flex-shrink-0">
        <div className="flex flex-row items-center gap-2">
          <GitMerge color="#6da3ff" />
          <h1 className="text-white font-bold text-xl">Recent Deployment</h1>
        </div>
        <div>
          <h1 className="text-green-500 text-sm">{successRate}% success rate</h1>
        </div>
      </div>

      {message ? (
        <div className="mb-3 rounded border border-[#5D5A5A] bg-[#ffffff]/5 px-3 py-2 text-xs text-gray-200">
          {message}
        </div>
      ) : null}

      <div className="space-y-2 overflow-y-auto scrollbar-hide flex-1 min-h-0">
        {isLoading ? (
          <div className="text-sm text-gray-300">Loading deployment history...</div>
        ) : null}

        {!isLoading && deployments.length === 0 ? (
          <div className="text-sm text-gray-300 border border-[#5D5A5A] rounded-md p-3 bg-[#ffffff]/5">
            No deployment history yet. Configure a Kubernetes connection and optional GitHub repo.
          </div>
        ) : null}

        {deployments.map((deployment, index) => (
          <div key={`${deployment.name}-${index}`}>
            <button
              type="button"
              onClick={() => toggleExpand(index)}
              className="w-full border border-[#9C9C9C] bg-[#ffffff]/4 rounded-md p-3 hover:bg-[#ffffff]/8 transition text-left"
            >
              <div className="flex flex-row justify-between items-center">
                <div className="flex flex-col gap-2">
                  <h1 className="text-white font-semibold">{deployment.name}</h1>
                  <div className="flex flex-row gap-2 items-center text-xs text-gray-300">
                    <span className="font-mono">{deployment.currentVersion}</span>
                    <div className="w-1 h-1 rounded-full bg-white" />
                    <span>{deployment.deployedTime}</span>
                    <div className="w-1 h-1 rounded-full bg-white" />
                    <span>{deployment.source}</span>
                    <div className="w-1 h-1 rounded-full bg-white" />
                    <span>{deployment.versionCount} versions</span>
                    <div className="w-1 h-1 rounded-full bg-white" />
                    <span>{deployment.commitCount} commits</span>
                  </div>
                </div>
                <div className="flex flex-row items-center gap-3">
                  <div className="text-right">
                    <p className="text-green-500 text-xs font-semibold">{deployment.status}</p>
                    <p className="text-white text-xs">{deployment.deployment}</p>
                  </div>
                  <Triangle
                    size={15}
                    color="white"
                    className={`transition-transform ${expandedIndex === index ? "rotate-0" : "rotate-180"}`}
                  />
                </div>
              </div>
            </button>

            {expandedIndex === index ? (
              <div className="mt-2 border border-[#9C9C9C]/50 bg-[#ffffff]/[0.02] rounded-md p-3 space-y-2">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-gray-400 text-xs font-semibold">Version History</h3>
                  <p className="text-[11px] text-gray-400">
                    {deployment.versionCount} deployment versions • {deployment.commitCount} repo commits
                  </p>
                </div>
                {deployment.versions.length === 0 ? (
                  <div className="text-xs text-gray-400">No versions available for this service.</div>
                ) : null}
                {deployment.versions.map((version, versionIndex) => {
                  const rollbackKey = `${deployment.name}:${version.revision ? `revision ${version.revision}` : version.version}`;
                  const canRollback = version.source === "kubernetes" && version.status !== "Current";

                  return (
                    <div
                      key={`${version.version}-${versionIndex}`}
                      className="flex flex-row justify-between items-center p-2 hover:bg-[#ffffff]/5 rounded transition"
                    >
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-white text-sm font-mono">{version.version}</p>
                          <span className={`text-[10px] px-2 py-[2px] rounded-full ${version.source === "kubernetes" ? "bg-sky-500/20 text-sky-300" : "bg-violet-500/20 text-violet-300"}`}>
                            {version.source}
                          </span>
                          {version.link ? (
                            <button
                              type="button"
                              onClick={() => window.open(version.link, "_blank", "noopener,noreferrer")}
                              className="text-gray-300 hover:text-white"
                              aria-label="Open GitHub commit"
                            >
                              <ExternalLink size={13} />
                            </button>
                          ) : null}
                        </div>
                        <p className="text-gray-400 text-xs truncate">{version.message}</p>
                        <p className="text-gray-500 text-[11px]">{version.time}</p>
                      </div>

                      {canRollback ? (
                        <button
                          type="button"
                          disabled={rollingBackKey === rollbackKey}
                          onClick={() => rollback(deployment.name, version)}
                          className="flex items-center gap-1 px-3 py-1 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/50 text-orange-400 rounded text-xs transition disabled:opacity-50"
                        >
                          <RotateCcw size={12} />
                          {rollingBackKey === rollbackKey ? "Rolling back..." : "Rollback"}
                        </button>
                      ) : null}

                      {!canRollback && version.status === "Current" ? (
                        <span className="text-green-500 text-xs font-semibold">Current</span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default RecentDeployment;
