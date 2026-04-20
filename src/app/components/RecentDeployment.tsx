"use client";

import { ExternalLink, GitMerge, RotateCcw, Triangle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type AgentSnapshot = {
  id: string;
  timestamp: string;
  image_tag: string;
  status: "PENDING" | "STABLE" | "ROLLED_BACK";
  tsd_baseline: Record<string, number>;
  lsi_baseline: number;
};

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
  const [activeTab, setActiveTab] = useState<"k8s" | "backtrack">("k8s");
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
  const [deployments, setDeployments] = useState<DeploymentItem[]>([]);
  const [connectionId, setConnectionId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string>("");
  const [rollingBackKey, setRollingBackKey] = useState<string>("");
  const hasLoadedRef = useRef(false);

  const [agentSnapshots, setAgentSnapshots] = useState<AgentSnapshot[]>([]);
  const [agentOnline, setAgentOnline] = useState(false);
  const [agentRollingBack, setAgentRollingBack] = useState(false);
  const [agentMessage, setAgentMessage] = useState<string>("");

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

  const loadAgentVersions = async () => {
    try {
      const res = await fetch("/api/agent?path=versions", { cache: "no-store" });
      if (!res.ok) { setAgentOnline(false); return; }
      const data = await res.json();
      if (!data.error && Array.isArray(data)) {
        setAgentSnapshots(data);
        setAgentOnline(true);
      } else {
        setAgentOnline(false);
      }
    } catch {
      setAgentOnline(false);
    }
  };

  const rollbackToSnapshot = async (snapshot: AgentSnapshot) => {
    const confirmed = window.confirm(`Rollback to ${snapshot.image_tag}?`);
    if (!confirmed) return;
    setAgentRollingBack(true);
    setAgentMessage("");
    try {
      const res = await fetch("/api/agent?path=rollback/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot_id: snapshot.id }),
      });
      const data = await res.json();
      setAgentMessage(data.message || (data.success ? "Rollback triggered." : "Rollback failed."));
      loadAgentVersions();
    } catch {
      setAgentMessage("Failed to reach agent.");
    } finally {
      setAgentRollingBack(false);
    }
  };

  useEffect(() => {
    loadHistory();
    loadAgentVersions();

    const refresh = () => {
      loadHistory();
      loadAgentVersions();
    };

    const timer = window.setInterval(() => { loadHistory(); loadAgentVersions(); }, 20000);
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
      <div className="flex flex-row gap-2 justify-between mb-3 flex-shrink-0">
        <div className="flex flex-row items-center gap-2">
          <GitMerge color="#6da3ff" />
          <h1 className="text-white font-bold text-xl">Recent Deployment</h1>
        </div>
        <div>
          <h1 className="text-green-500 text-sm">{successRate}% success rate</h1>
        </div>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 mb-3 flex-shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab("k8s")}
          className={`px-3 py-1 rounded-md text-xs transition ${activeTab === "k8s" ? "bg-sky-500/20 text-sky-300 border border-sky-500/40" : "text-white/40 hover:text-white/60 border border-transparent"}`}
        >
          K8s History
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("backtrack")}
          className={`px-3 py-1 rounded-md text-xs transition flex items-center gap-1 ${activeTab === "backtrack" ? "bg-teal-500/20 text-teal-300 border border-teal-500/40" : "text-white/40 hover:text-white/60 border border-transparent"}`}
        >
          BackTrack Versions
          {agentOnline ? <span className="w-1.5 h-1.5 rounded-full bg-teal-400" /> : <span className="w-1.5 h-1.5 rounded-full bg-white/20" />}
        </button>
      </div>

      {activeTab === "backtrack" ? (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide space-y-2">
          {agentMessage ? (
            <div className="mb-2 rounded border border-[#5D5A5A] bg-[#ffffff]/5 px-3 py-2 text-xs text-gray-200">
              {agentMessage}
            </div>
          ) : null}
          {!agentOnline ? (
            <div className="text-sm text-gray-400 border border-[#5D5A5A] rounded-md p-3 bg-[#ffffff]/5">
              BackTrack agent offline — start backtrack-agent on port 9090 to see version history.
            </div>
          ) : agentSnapshots.length === 0 ? (
            <div className="text-sm text-gray-400 border border-[#5D5A5A] rounded-md p-3 bg-[#ffffff]/5">
              No version snapshots yet.
            </div>
          ) : agentSnapshots.map((snap) => {
            const statusColors: Record<string, string> = {
              PENDING: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
              STABLE: "bg-green-500/15 text-green-300 border-green-500/30",
              ROLLED_BACK: "bg-white/5 text-white/35 border-white/10",
            };
            const canRollback = snap.status === "STABLE";
            const relTime = new Date(snap.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
            const hasTsd = snap.tsd_baseline && Object.keys(snap.tsd_baseline).length > 0;
            return (
              <div key={snap.id} className="border border-[#9C9C9C] bg-[#ffffff]/4 rounded-md p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-white text-sm truncate">{snap.image_tag}</span>
                      <span className={`text-[10px] px-2 py-[2px] rounded-full border ${statusColors[snap.status] || statusColors.PENDING}`}>
                        {snap.status}
                      </span>
                    </div>
                    <span className="text-gray-500 text-[11px]">{relTime}</span>
                    {hasTsd ? (
                      <div className="flex gap-3 text-[10px] text-white/40 mt-0.5">
                        {snap.tsd_baseline.cpu_percent !== undefined ? (
                          <span>CPU {snap.tsd_baseline.cpu_percent.toFixed(1)}%</span>
                        ) : null}
                        {snap.tsd_baseline.memory_mb !== undefined ? (
                          <span>Mem {snap.tsd_baseline.memory_mb.toFixed(0)} MB</span>
                        ) : null}
                        {snap.lsi_baseline > 0 ? (
                          <span>LSI {snap.lsi_baseline.toFixed(4)}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {canRollback ? (
                    <button
                      type="button"
                      disabled={agentRollingBack}
                      onClick={() => rollbackToSnapshot(snap)}
                      className="flex items-center gap-1 px-3 py-1 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/50 text-orange-400 rounded text-xs transition disabled:opacity-50 shrink-0"
                    >
                      <RotateCcw size={12} />
                      {agentRollingBack ? "Rolling back..." : "Rollback"}
                    </button>
                  ) : snap.status === "PENDING" ? (
                    <span className="text-yellow-400 text-xs shrink-0">Current</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {activeTab === "k8s" ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}

export default RecentDeployment;
