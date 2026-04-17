"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Nav from "../components/Nav";

const KubernetesTerminal = dynamic(() => import("./KubernetesTerminal"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-white/30 text-sm">
      Loading terminal...
    </div>
  ),
});

type TSDSummary = {
  current: {
    cpu_percent: number;
    memory_mb: number;
    latency_ms: number;
    error_rate_percent: number;
  };
  readings_count: number;
  is_drifting: boolean;
};

type LSISummary = {
  fitted: boolean;
  corpus_size: number;
  current_score: number;
  baseline_mean: number;
  threshold: number;
  is_anomalous: boolean;
  score_history: number[];
};

export default function AnomaliesPage() {
  const [tsd, setTsd] = useState<TSDSummary | null>(null);
  const [lsi, setLsi] = useState<LSISummary | null>(null);
  const [agentOnline, setAgentOnline] = useState(false);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const [healthRes, metricsRes, lsiRes] = await Promise.all([
          fetch("/api/agent?path=health", { cache: "no-store" }),
          fetch("/api/agent?path=metrics", { cache: "no-store" }),
          fetch("/api/agent?path=lsi", { cache: "no-store" }),
        ]);

        if (!active) return;

        if (metricsRes.ok) {
          const data = await metricsRes.json();
          if (!data.error) setTsd(data);
        }
        if (lsiRes.ok) {
          const data = await lsiRes.json();
          if (!data.error) setLsi(data);
        }

        setAgentOnline(healthRes.ok);
      } catch {
        if (active) setAgentOnline(false);
      }
    };

    poll();
    const timer = window.setInterval(poll, 5000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="w-full h-screen flex flex-col bg-[#161C27] overflow-hidden">
      <Nav />

      <div className="p-6 flex-1 grid grid-cols-3 gap-4 overflow-hidden min-h-0">
        {/* Left — Terminal (2/3) */}
        <div className="col-span-2 border border-[#5D5A5A] rounded-2xl p-5 bg-[#FFFFFF]/[0.02] min-h-0 h-full flex flex-col overflow-hidden">
          <h2 className="text-white font-bold text-lg mb-3">Terminal</h2>
          <div className="flex-1 min-h-0 p-2">
            <KubernetesTerminal />
          </div>
        </div>

        {/* Right — Agent panels (1/3) */}
        <div className="col-span-1 grid grid-rows-2 gap-4 min-h-0 h-full">
          {/* TSD Panel */}
          <div className="border border-[#5D5A5A] rounded-2xl p-5 bg-[#FFFFFF]/[0.02] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-bold text-base">TSD Metrics</h2>
              <span
                className={`text-[10px] rounded-full px-2 py-0.5 ${
                  tsd?.is_drifting
                    ? "bg-red-500/15 text-red-300 border border-red-500/30"
                    : agentOnline
                      ? "bg-green-500/15 text-green-300 border border-green-500/30"
                      : "bg-white/5 text-white/40 border border-white/10"
                }`}
              >
                {tsd?.is_drifting
                  ? "DRIFTING"
                  : agentOnline
                    ? "NORMAL"
                    : "OFFLINE"}
              </span>
            </div>

            {tsd ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      label: "CPU",
                      value: `${tsd.current.cpu_percent.toFixed(1)}%`,
                      color: "text-green-400",
                    },
                    {
                      label: "Memory",
                      value: `${tsd.current.memory_mb.toFixed(1)} MB`,
                      color: "text-sky-400",
                    },
                    {
                      label: "Latency",
                      value: `${tsd.current.latency_ms.toFixed(0)} ms`,
                      color: "text-purple-400",
                    },
                    {
                      label: "Error Rate",
                      value: `${tsd.current.error_rate_percent.toFixed(2)}%`,
                      color: "text-red-400",
                    },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="rounded-lg border border-white/5 bg-[#0f1420] p-2"
                    >
                      <div className="text-[9px] uppercase tracking-wide text-white/35">
                        {m.label}
                      </div>
                      <div className={`mt-0.5 text-sm font-bold ${m.color}`}>
                        {m.value}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-white/40">
                  {tsd.readings_count} readings collected
                  {tsd.readings_count < 12 &&
                    ` (need ${12 - tsd.readings_count} more for STL)`}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                {agentOnline
                  ? "Loading metrics..."
                  : "Start backtrack-agent to see TSD metrics. Agent runs on port 9090."}
              </p>
            )}
          </div>

          {/* LSI Panel */}
          <div className="border border-[#5D5A5A] rounded-2xl p-5 bg-[#FFFFFF]/[0.02] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-bold text-base">LSI Analysis</h2>
              <span
                className={`text-[10px] rounded-full px-2 py-0.5 ${
                  lsi?.is_anomalous
                    ? "bg-red-500/15 text-red-300 border border-red-500/30"
                    : agentOnline
                      ? "bg-green-500/15 text-green-300 border border-green-500/30"
                      : "bg-white/5 text-white/40 border border-white/10"
                }`}
              >
                {lsi?.is_anomalous
                  ? "ANOMALOUS"
                  : agentOnline
                    ? "NORMAL"
                    : "OFFLINE"}
              </span>
            </div>

            {lsi ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-white/5 bg-[#0f1420] p-2">
                    <div className="text-[9px] uppercase tracking-wide text-white/35">
                      Score
                    </div>
                    <div
                      className={`mt-0.5 text-sm font-bold ${lsi.is_anomalous ? "text-red-400" : "text-cyan-300"}`}
                    >
                      {lsi.current_score.toFixed(4)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-[#0f1420] p-2">
                    <div className="text-[9px] uppercase tracking-wide text-white/35">
                      Threshold
                    </div>
                    <div className="mt-0.5 text-sm font-bold text-white/70">
                      {lsi.threshold.toFixed(4)}
                    </div>
                  </div>
                </div>

                {/* Mini score history */}
                {lsi.score_history.length > 0 && (
                  <div className="relative h-16 overflow-hidden rounded-lg border border-white/5 bg-[#0b101a] px-2 py-2">
                    {lsi.threshold > 0 && (
                      <div
                        className="absolute inset-x-0 border-t border-dashed border-red-500/40"
                        style={{
                          top: `${Math.max(10, 100 - (lsi.threshold / Math.max(...lsi.score_history, lsi.threshold, 0.1)) * 100)}%`,
                        }}
                      />
                    )}
                    <div className="absolute inset-0 flex items-end gap-[1px] px-2 pb-2">
                      {lsi.score_history.slice(-20).map((score, i) => {
                        const max = Math.max(
                          ...lsi.score_history,
                          lsi.threshold,
                          0.1,
                        );
                        const height = Math.max(2, (score / max) * 100);
                        const hot = score > lsi.threshold;
                        return (
                          <div key={i} className="flex-1">
                            <div
                              className={`w-full rounded-t ${hot ? "bg-red-400/80" : "bg-cyan-400/60"}`}
                              style={{ height: `${height}%` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="text-[10px] text-white/40">
                  {lsi.fitted
                    ? `Model active — baseline ${lsi.baseline_mean.toFixed(4)}`
                    : `Training corpus (${lsi.corpus_size}/200 lines)`}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                {agentOnline
                  ? "Loading LSI data..."
                  : "Start backtrack-agent to see LSI analysis."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
