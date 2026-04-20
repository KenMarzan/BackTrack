"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";

// --- Types matching agent response shapes ---

type TSDMetrics = {
  current: {
    cpu_percent: number;
    memory_mb: number;
    latency_ms: number;
    error_rate_percent: number;
  };
  history: {
    cpu: number[];
    memory: number[];
    latency: number[];
    error_rate: number[];
  };
  residuals: {
    cpu: number[];
    memory: number[];
    latency: number[];
    error_rate: number[];
  };
  readings_count: number;
  is_drifting: boolean;
};

type LSIData = {
  fitted: boolean;
  corpus_size: number;
  current_score: number;
  baseline_mean: number;
  threshold: number;
  is_anomalous: boolean;
  window_counts: { INFO: number; WARN: number; ERROR: number; NOVEL: number };
  score_history: number[];
  recent_lines: Array<{ line: string; label: string; timestamp: number }>;
};

type VersionSnapshot = {
  id: string;
  image_tag: string;
  status: string;
  created_at: string;
};

// --- Helpers ---

function severityTone(severity: string) {
  const tone = severity.toLowerCase();
  if (tone === "critical")
    return {
      badge: "bg-red-500/15 text-red-300 border-red-500/30",
      accent: "text-red-400",
      outline: "border-red-500/40",
      dot: "bg-red-400",
    };
  if (tone === "high")
    return {
      badge: "bg-orange-500/15 text-orange-300 border-orange-500/30",
      accent: "text-orange-400",
      outline: "border-orange-500/40",
      dot: "bg-orange-400",
    };
  return {
    badge: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
    accent: "text-yellow-400",
    outline: "border-yellow-500/40",
    dot: "bg-yellow-400",
  };
}

function decode(value: string | null) {
  return value ? decodeURIComponent(value) : "unknown";
}

// --- Root Cause Analysis helpers ---

type InsightDriver = "TSD_DRIFT" | "LSI_ANOMALOUS" | "BOTH" | "NONE";

type RootCauseInsight = {
  driver: InsightDriver;
  driftingMetrics: Array<{
    name: string;
    lastResidual: number;
    iqrThreshold: number;
    ratio: number;
  }>;
  novelRatio: number;
  errorRatio: number;
  scoreRatio: number;
  novelLines: Array<{ line: string; timestamp: number }>;
  headline: string;
  explanation: string;
};

function estimateIQR(values: number[]): number {
  if (values.length < 4) return 1;
  const sorted = [...values].map(Math.abs).sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  return Math.max(q3 - q1, 0.001);
}

const METRIC_DEFS = [
  { name: "CPU", key: "cpu" as const },
  { name: "Memory", key: "memory" as const },
  { name: "Latency", key: "latency" as const },
  { name: "Error Rate", key: "error_rate" as const },
];

function generateInsight(
  tsd: TSDMetrics | null,
  lsi: LSIData | null,
): RootCauseInsight {
  const empty: RootCauseInsight = {
    driver: "NONE",
    driftingMetrics: [],
    novelRatio: 0,
    errorRatio: 0,
    scoreRatio: 0,
    novelLines: [],
    headline: "No active anomaly signals.",
    explanation: "Both TSD residuals and LSI log scores are within normal bounds.",
  };

  if (!tsd && !lsi) return empty;

  const driftingMetrics: RootCauseInsight["driftingMetrics"] = [];
  if (tsd?.is_drifting) {
    for (const def of METRIC_DEFS) {
      const residuals = tsd.residuals[def.key];
      const lastResidual = residuals.at(-1) ?? 0;
      const iqrThreshold = 3.0 * estimateIQR(residuals);
      const ratio = Math.abs(lastResidual) / iqrThreshold;
      if (ratio > 1.0) {
        driftingMetrics.push({ name: def.name, lastResidual, iqrThreshold, ratio });
      }
    }
    driftingMetrics.sort((a, b) => b.ratio - a.ratio);
  }

  const wc = lsi?.window_counts ?? { INFO: 0, WARN: 0, ERROR: 0, NOVEL: 0 };
  const total = Math.max((wc.INFO + wc.WARN + wc.ERROR + wc.NOVEL), 1);
  const novelRatio = wc.NOVEL / total;
  const errorRatio = wc.ERROR / total;
  const scoreRatio = (lsi?.current_score ?? 0) / Math.max(lsi?.threshold ?? 0.0001, 0.0001);
  const novelLines = (lsi?.recent_lines ?? [])
    .filter((e) => e.label === "NOVEL")
    .slice(0, 3)
    .map((e) => ({ line: e.line, timestamp: e.timestamp }));

  const isDrifting = tsd?.is_drifting ?? false;
  const isAnomalous = lsi?.is_anomalous ?? false;

  let driver: InsightDriver = "NONE";
  if (isDrifting && isAnomalous) driver = "BOTH";
  else if (isDrifting) driver = "TSD_DRIFT";
  else if (isAnomalous) driver = "LSI_ANOMALOUS";

  const topMetric = driftingMetrics[0];

  let headline = "No active anomaly signals.";
  let explanation = "Both TSD residuals and LSI log scores are within normal bounds.";

  if (driver === "BOTH") {
    headline = `Correlated metric drift and anomalous log patterns detected.`;
    explanation =
      topMetric
        ? `${topMetric.name} residuals are approximately ${topMetric.ratio.toFixed(1)}× above the 3×IQR drift threshold, indicating a structural shift in ${topMetric.name.toLowerCase()} behavior. ` +
          `Simultaneously, ${(novelRatio * 100).toFixed(0)}% of recent log lines are NOVEL patterns — sequences with cosine similarity < 0.25 to all baseline centroids. ` +
          `LSI score is ${scoreRatio.toFixed(1)}× the anomaly threshold, suggesting a new failure mode rather than a known error class.`
        : `Both TSD drift and LSI anomaly signals are active. LSI score is ${scoreRatio.toFixed(1)}× the anomaly threshold with ${(novelRatio * 100).toFixed(0)}% NOVEL log lines.`;
  } else if (driver === "TSD_DRIFT") {
    headline = `Metric drift detected — log patterns nominal.`;
    explanation = topMetric
      ? `${topMetric.name} residuals are approximately ${topMetric.ratio.toFixed(1)}× above the 3×IQR threshold after STL decomposition, meaning the trend and seasonal components no longer explain the observed values. ` +
        `This pattern suggests a resource regression or infrastructure issue rather than an application error, as log semantics remain within the trained baseline.`
      : `TSD residuals are outside normal bounds after STL decomposition. Log semantics remain within the trained baseline.`;
  } else if (driver === "LSI_ANOMALOUS") {
    headline = `Anomalous log patterns without metric drift.`;
    explanation =
      `LSI score is ${scoreRatio.toFixed(1)}× the anomaly threshold, driven by ${(novelRatio * 100).toFixed(0)}% NOVEL and ${(errorRatio * 100).toFixed(0)}% ERROR log lines in the current 30-second window. ` +
      `NOVEL lines are log sequences with cosine similarity < 0.25 to all SVD baseline centroids — indicating new, unseen error paths or dependency failures not present during baseline training. ` +
      `CPU, memory, and latency residuals are within normal bounds.`;
  }

  return { driver, driftingMetrics, novelRatio, errorRatio, scoreRatio, novelLines, headline, explanation };
}

// --- Mini bar chart component ---

function BarChart({
  values,
  threshold,
  color,
  maxBars = 20,
}: {
  values: number[];
  threshold?: number;
  color: string;
  maxBars?: number;
}) {
  const data = values.slice(-maxBars);
  const max = Math.max(...data, threshold ?? 0, 1);

  return (
    <div className="relative h-[120px] overflow-hidden rounded-2xl border border-white/5 bg-[#0b101a] px-3 py-3">
      {threshold !== undefined && (
        <div
          className="absolute inset-x-0 border-t border-dashed border-red-500/40"
          style={{ top: `${Math.max(10, 100 - (threshold / max) * 100)}%` }}
        />
      )}
      <div className="absolute inset-0 flex items-end gap-[2px] px-3 pb-3">
        {data.map((value, i) => {
          const height = Math.max(2, (Math.abs(value) / max) * 100);
          const isAboveThreshold =
            threshold !== undefined && Math.abs(value) > threshold;
          return (
            <div key={i} className="flex-1">
              <div
                className={`w-full rounded-t ${isAboveThreshold ? "bg-gradient-to-t from-red-500/50 to-red-400/90" : color}`}
                style={{ height: `${height}%` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Main page ---

export default function ServiceDiagnosticsPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const serviceName = decodeURIComponent(params.service as string);
  const namespace = decode(searchParams.get("namespace"));
  const severity = decode(searchParams.get("severity"));
  const metric = decode(searchParams.get("metric"));
  const current = decode(searchParams.get("current"));
  const baseline = decode(searchParams.get("baseline"));
  const message = decode(searchParams.get("message"));
  const tones = severityTone(severity);

  const [tsd, setTsd] = useState<TSDMetrics | null>(null);
  const [lsi, setLsi] = useState<LSIData | null>(null);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [agentOnline, setAgentOnline] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>("");

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const svcParam = `&service=${encodeURIComponent(serviceName)}`;
        const [metricsRes, lsiRes, versionsRes] = await Promise.all([
          fetch(`/api/agent?path=metrics${svcParam}`, { cache: "no-store" }),
          fetch(`/api/agent?path=lsi${svcParam}`, { cache: "no-store" }),
          fetch("/api/agent?path=versions", { cache: "no-store" }),
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
        if (versionsRes.ok) {
          const data = await versionsRes.json();
          if (!data.error) setVersions(Array.isArray(data) ? data : []);
        }

        setAgentOnline(metricsRes.ok || lsiRes.ok);
        setLastUpdate(new Date().toLocaleTimeString());
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

  // Derived values from agent data
  const stableVersion = versions.find((v) => v.status === "STABLE");
  const pendingVersion = versions.find((v) => v.status === "PENDING");
  const currentVersion = pendingVersion || versions[0];

  // TSD derived
  const cpuResiduals = tsd?.residuals.cpu ?? [];
  const memResiduals = tsd?.residuals.memory ?? [];
  const latResiduals = tsd?.residuals.latency ?? [];
  const lastCpuResidual = cpuResiduals.at(-1) ?? 0;
  const lastMemResidual = memResiduals.at(-1) ?? 0;
  const lastLatResidual = latResiduals.at(-1) ?? 0;

  // TSD error_rate residuals
  const errResiduals = tsd?.residuals.error_rate ?? [];
  const lastErrResidual = errResiduals.at(-1) ?? 0;

  // LSI derived
  const scoreHistory = lsi?.score_history ?? [];
  const recentLines = lsi?.recent_lines ?? [];
  const novelLogLines = recentLines.filter((e) => e.label === "NOVEL");
  const otherLogLines = recentLines.filter((e) => e.label !== "NOVEL");

  // Root cause insight
  const insight = generateInsight(tsd, lsi);

  return (
    <div className="h-screen w-full overflow-hidden bg-[#151a24] text-white">
      <div className="flex h-full min-h-0 flex-col">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 bg-[#1b212d] px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/anomalies"
              className="flex items-center gap-1 text-sm text-white/60 hover:text-white transition"
            >
              <ArrowLeft size={14} />
              Back
            </Link>
            <div className="h-4 w-px bg-white/10" />
            <div className="text-sm font-semibold text-white/90">
              {serviceName}
            </div>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] ${tones.badge}`}
            >
              {severity.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${agentOnline ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${agentOnline ? "bg-green-400" : "bg-red-400"}`}
              />
              Agent {agentOnline ? "Online" : "Offline"}
            </span>
            {lastUpdate && (
              <span className="text-white/40">Updated {lastUpdate}</span>
            )}
          </div>
        </header>

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden p-4 gap-4">
          {/* Left column — TSD + LSI panels */}
          <div className="flex w-[440px] shrink-0 flex-col gap-4 overflow-y-auto pr-1">
            {/* Status banner */}
            <div
              className={`flex items-center gap-3 rounded-2xl border border-white/5 bg-[#0f1420] px-4 py-3`}
            >
              <div
                className={`text-[11px] font-semibold tracking-wide ${tsd?.is_drifting || lsi?.is_anomalous ? tones.accent : "text-green-400"}`}
              >
                {tsd?.is_drifting || lsi?.is_anomalous
                  ? "ANOMALY DETECTED"
                  : "SYSTEM NOMINAL"}
              </div>
              {tsd?.is_drifting && (
                <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300">
                  TSD DRIFT
                </span>
              )}
              {lsi?.is_anomalous && (
                <span className="rounded-md border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-300">
                  LSI ANOMALY
                </span>
              )}
            </div>

            {/* Version comparison */}
            <div className="flex items-center gap-3">
              <div className="flex-1 rounded-xl border border-white/5 bg-[#0f1420] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wide text-white/40">
                  Current
                </div>
                <div className={`mt-1 text-sm font-bold ${tones.accent}`}>
                  {currentVersion?.image_tag || "N/A"}
                </div>
                <div className="mt-0.5 text-[10px] text-white/30">
                  {currentVersion?.status || "—"}
                </div>
              </div>
              <RefreshCw size={14} className="shrink-0 text-white/30" />
              <div className="flex-1 rounded-xl border border-green-500/20 bg-[#0f1420] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wide text-white/40">
                  Last Stable
                </div>
                <div className="mt-1 text-sm font-bold text-green-400">
                  {stableVersion?.image_tag || "N/A"}
                </div>
                <div className="mt-0.5 text-[10px] text-white/30">
                  {stableVersion
                    ? new Date(stableVersion.created_at).toLocaleString()
                    : "—"}
                </div>
              </div>
            </div>

            {/* TSD: Time Series Decomposition */}
            <div className="rounded-[20px] border border-white/5 bg-[#171e29] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                  Time Series Decomposition
                </div>
                <div className="text-[10px] text-white/30">
                  {tsd?.readings_count ?? 0} readings
                </div>
              </div>

              {/* Current metrics */}
              <div className="mb-3 grid grid-cols-4 gap-2">
                <div className="rounded-xl border border-white/5 bg-[#0f1420] p-2.5">
                  <div className="text-[9px] uppercase tracking-wide text-white/35">
                    CPU
                  </div>
                  <div className="mt-1 text-base font-bold text-green-400">
                    {tsd?.current.cpu_percent.toFixed(1) ?? "—"}%
                  </div>
                </div>
                <div className="rounded-xl border border-white/5 bg-[#0f1420] p-2.5">
                  <div className="text-[9px] uppercase tracking-wide text-white/35">
                    Memory
                  </div>
                  <div className="mt-1 text-base font-bold text-sky-400">
                    {tsd?.current.memory_mb.toFixed(1) ?? "—"} MB
                  </div>
                </div>
                <div className="rounded-xl border border-white/5 bg-[#0f1420] p-2.5">
                  <div className="text-[9px] uppercase tracking-wide text-white/35">
                    Latency
                  </div>
                  <div className="mt-1 text-base font-bold text-purple-400">
                    {tsd?.current.latency_ms.toFixed(0) ?? "—"} ms
                  </div>
                </div>
                <div className="rounded-xl border border-white/5 bg-[#0f1420] p-2.5">
                  <div className="text-[9px] uppercase tracking-wide text-white/35">
                    Error Rate
                  </div>
                  <div className="mt-1 text-base font-bold text-red-400">
                    {tsd?.current.error_rate_percent.toFixed(2) ?? "—"}%
                  </div>
                </div>
              </div>

              {/* Residual values */}
              <div className="mb-3 grid grid-cols-4 gap-2">
                {[
                  {
                    label: "CPU Residual",
                    value: lastCpuResidual,
                    threshold: 3 * estimateIQR(cpuResiduals),
                  },
                  {
                    label: "Mem Residual",
                    value: lastMemResidual,
                    threshold: 3 * estimateIQR(memResiduals),
                  },
                  {
                    label: "Lat Residual",
                    value: lastLatResidual,
                    threshold: 3 * estimateIQR(latResiduals),
                  },
                  {
                    label: "Err Residual",
                    value: lastErrResidual,
                    threshold: 3 * estimateIQR(errResiduals),
                  },
                ].map((row) => {
                  const isHot = row.threshold > 0 && Math.abs(row.value) > row.threshold;
                  return (
                    <div
                      key={row.label}
                      className="rounded-xl border border-white/5 bg-[#0f1420] p-2.5"
                    >
                      <div className="text-[9px] uppercase tracking-wide text-white/35">
                        {row.label}
                      </div>
                      <div className={`mt-1 text-lg font-bold ${isHot ? "text-red-400" : "text-green-400"}`}>
                        {(row.value > 0 ? "+" : "") + row.value.toFixed(3)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* All 4 residual sparklines */}
              {(cpuResiduals.length > 0 || memResiduals.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: "CPU Residuals",
                      values: cpuResiduals,
                      last: lastCpuResidual,
                      color: "bg-gradient-to-t from-green-500/30 to-green-400/70",
                    },
                    {
                      label: "Memory Residuals",
                      values: memResiduals,
                      last: lastMemResidual,
                      color: "bg-gradient-to-t from-sky-500/30 to-sky-400/70",
                    },
                    {
                      label: "Latency Residuals",
                      values: latResiduals,
                      last: lastLatResidual,
                      color: "bg-gradient-to-t from-purple-500/30 to-purple-400/70",
                    },
                    {
                      label: "Error Rate Residuals",
                      values: errResiduals,
                      last: lastErrResidual,
                      color: "bg-gradient-to-t from-red-500/30 to-red-400/70",
                    },
                  ].map((chart) => (
                    <div key={chart.label}>
                      <div className="mb-1 flex items-center justify-between text-[10px]">
                        <span className="text-white/40">{chart.label}</span>
                        <span className="font-mono text-white/40">
                          {(chart.last > 0 ? "+" : "") + chart.last.toFixed(2)}
                        </span>
                      </div>
                      {chart.values.length > 0 ? (
                        <BarChart
                          values={chart.values}
                          color={chart.color}
                          threshold={3 * estimateIQR(chart.values)}
                        />
                      ) : (
                        <div className="h-[120px] rounded-2xl border border-white/5 bg-[#0b101a] flex items-center justify-center text-[10px] text-white/20">
                          No data
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Drift diagnosis */}
              <div className="mt-3 rounded-xl border border-white/5 bg-[#0b101a] p-3 text-[11px] leading-5 text-white/70">
                <span className="font-semibold text-white/90">TSD Status:</span>{" "}
                {tsd?.is_drifting ? (
                  <span className="text-red-400">
                    Residual drift detected — anomalous readings exceed 3xIQR
                    threshold on {tsd.readings_count} readings.
                  </span>
                ) : tsd ? (
                  <span className="text-green-400">
                    All residuals within normal bounds.{" "}
                    {tsd.readings_count < 12 &&
                      `Warming up (${tsd.readings_count}/12 readings).`}
                  </span>
                ) : (
                  <span className="text-white/40">
                    Waiting for agent connection...
                  </span>
                )}
              </div>
            </div>

            {/* LSI: Log Semantic Indexing */}
            <div className="rounded-[20px] border border-white/5 bg-[#171e29] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                  Latent Semantic Indexing (SVD)
                </div>
                <div className="text-[10px] text-white/30">
                  {lsi?.fitted
                    ? "Model Active"
                    : `Collecting corpus (${lsi?.corpus_size ?? 0}/200)`}
                </div>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/5 bg-[#0f1420] p-2.5">
                  <div className="text-[9px] uppercase tracking-wide text-white/35">
                    Current Score
                  </div>
                  <div
                    className={`mt-1 text-lg font-bold ${lsi?.is_anomalous ? "text-red-400" : "text-cyan-300"}`}
                  >
                    {lsi?.current_score.toFixed(4) ?? "—"}
                  </div>
                </div>
                <div className="rounded-xl border border-white/5 bg-[#0f1420] p-2.5">
                  <div className="text-[9px] uppercase tracking-wide text-white/35">
                    Baseline Mean
                  </div>
                  <div className="mt-1 text-lg font-bold text-white/80">
                    {lsi?.baseline_mean.toFixed(4) ?? "—"}
                  </div>
                </div>
              </div>

              {/* Window classification counts */}
              {lsi?.fitted && (
                <div className="mb-3 grid grid-cols-4 gap-2">
                  {(
                    [
                      ["INFO", "text-green-400"],
                      ["WARN", "text-yellow-400"],
                      ["ERROR", "text-red-400"],
                      ["NOVEL", "text-purple-400"],
                    ] as const
                  ).map(([label, color]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-white/5 bg-[#0f1420] p-2 text-center"
                    >
                      <div className="text-[9px] uppercase tracking-wide text-white/35">
                        {label}
                      </div>
                      <div className={`mt-0.5 text-sm font-bold ${color}`}>
                        {lsi.window_counts[label] ?? 0}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* LSI score history chart */}
              {scoreHistory.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="text-white/40">Score History</span>
                    <span className="text-red-400/70">
                      Threshold {lsi?.threshold.toFixed(3)}
                    </span>
                  </div>
                  <BarChart
                    values={scoreHistory}
                    threshold={lsi?.threshold}
                    color="bg-gradient-to-t from-cyan-500/30 to-cyan-400/70"
                  />
                </div>
              )}

              <div className="mt-3 rounded-xl border border-white/5 bg-[#0b101a] p-3 text-[11px] leading-5 text-white/70">
                <span className="font-semibold text-white/90">LSI Status:</span>{" "}
                {lsi?.is_anomalous ? (
                  <span className="text-red-400">
                    Anomalous — score {lsi.current_score.toFixed(4)} exceeds{" "}
                    {lsi.threshold.toFixed(4)} threshold (
                    {lsi.baseline_mean.toFixed(4)} x{" "}
                    {(lsi.threshold / Math.max(lsi.baseline_mean, 0.0001)).toFixed(1)}
                    ).
                  </span>
                ) : lsi?.fitted ? (
                  <span className="text-green-400">
                    Log patterns within normal baseline.
                  </span>
                ) : (
                  <span className="text-white/40">
                    {lsi
                      ? `Building corpus (${lsi.corpus_size}/200 lines)...`
                      : "Waiting for agent connection..."}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Center — Log Feed */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            {/* Recent classified logs */}
            <div className="flex-1 overflow-hidden rounded-[20px] border border-white/5 bg-[#171e29] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                  Classified Log Stream
                </div>
                <div className="text-[10px] text-white/30">
                  {recentLines.length} lines (live)
                </div>
              </div>
              <div className="h-[calc(100%-2rem)] overflow-y-auto rounded-2xl border border-white/5 bg-[#0b101a] p-3 font-mono text-xs leading-5">
                {recentLines.length === 0 ? (
                  <div className="text-white/30 p-4 text-center">
                    {agentOnline
                      ? "Waiting for classified log lines..."
                      : "Connect backtrack-agent to see classified logs."}
                  </div>
                ) : (
                  <>
                    {novelLogLines.length > 0 && (
                      <>
                        <div className="mb-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-purple-400/70">
                          <span className="h-px flex-1 bg-purple-500/20" />
                          Unknown Patterns ({novelLogLines.length})
                          <span className="h-px flex-1 bg-purple-500/20" />
                        </div>
                        {novelLogLines.map((entry, i) => (
                          <div key={`novel-${i}`} className="flex gap-2 py-0.5 rounded bg-purple-500/5">
                            <span className="shrink-0 w-12 text-right font-semibold text-purple-400">
                              NOVEL
                            </span>
                            <span className="text-purple-200/70 truncate">{entry.line}</span>
                          </div>
                        ))}
                        {otherLogLines.length > 0 && (
                          <div className="my-2 flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-white/25">
                            <span className="h-px flex-1 bg-white/5" />
                            Classified Lines ({otherLogLines.length})
                            <span className="h-px flex-1 bg-white/5" />
                          </div>
                        )}
                      </>
                    )}
                    {otherLogLines.map((entry, i) => {
                      const labelColor =
                        entry.label === "ERROR"
                          ? "text-red-400"
                          : entry.label === "WARN"
                            ? "text-yellow-400"
                            : "text-green-400";
                      return (
                        <div key={`line-${i}`} className="flex gap-2 py-0.5">
                          <span className={`shrink-0 w-12 text-right font-semibold ${labelColor}`}>
                            {entry.label}
                          </span>
                          <span className="text-white/60 truncate">{entry.line}</span>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            {/* Metric history sparklines */}
            {tsd && (
              <div className="grid grid-cols-2 gap-4">
                {(
                  [
                    {
                      label: "Memory History",
                      data: tsd.history.memory,
                      color:
                        "bg-gradient-to-t from-sky-500/30 to-sky-400/70",
                      unit: "MB",
                    },
                    {
                      label: "Latency History",
                      data: tsd.history.latency,
                      color:
                        "bg-gradient-to-t from-purple-500/30 to-purple-400/70",
                      unit: "ms",
                    },
                  ] as const
                ).map((chart) => (
                  <div
                    key={chart.label}
                    className="rounded-[20px] border border-white/5 bg-[#171e29] p-4"
                  >
                    <div className="mb-1 flex items-center justify-between text-[10px]">
                      <span className="text-white/40">{chart.label}</span>
                      <span className="text-white/30">
                        {chart.data.at(-1)?.toFixed(1) ?? "—"} {chart.unit}
                      </span>
                    </div>
                    <BarChart
                      values={chart.data}
                      color={chart.color}
                      maxBars={36}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right sidebar — Summary */}
          <aside className="flex w-[280px] shrink-0 flex-col gap-4 overflow-y-auto">
            {/* Root Cause Analysis */}
            <div className="rounded-[20px] border border-white/5 bg-[#171e29] p-5">
              <div className="mb-4 flex items-center gap-2 font-semibold text-white">
                <Search size={16} />
                Root Cause Analysis
                {insight.driver !== "NONE" && (
                  <span className="ml-auto rounded-full border border-orange-500/30 bg-orange-500/15 px-2 py-0.5 text-[10px] text-orange-300">
                    ACTIVE
                  </span>
                )}
              </div>

              {/* Headline */}
              <div className="mb-3 rounded-xl border border-white/5 bg-[#0f1420] p-3">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-white/35">
                  Analysis
                </div>
                <div className="text-xs leading-5 text-white/80">
                  {insight.headline}
                </div>
              </div>

              {/* Explanation */}
              <p className="mb-3 text-[11px] leading-[1.65] text-white/55">
                {insight.explanation}
              </p>

              {/* Drifting metric callouts */}
              {insight.driftingMetrics.length > 0 && (
                <div className="mb-3 space-y-1.5">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-white/35">
                    Metric Drift
                  </div>
                  {insight.driftingMetrics.map((m) => (
                    <div
                      key={m.name}
                      className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2"
                    >
                      <span className="text-[11px] text-white/60">
                        {m.name} residual
                      </span>
                      <span className="text-[11px] font-bold text-red-400">
                        ~{m.ratio.toFixed(1)}× threshold
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* NOVEL ratio */}
              {lsi?.is_anomalous && (
                <div className="mb-3 flex items-center justify-between rounded-lg border border-purple-500/20 bg-purple-500/5 px-3 py-2">
                  <span className="text-[11px] text-white/60">NOVEL log ratio</span>
                  <span className="text-[11px] font-bold text-purple-400">
                    {(insight.novelRatio * 100).toFixed(0)}% of window
                  </span>
                </div>
              )}

              {/* NOVEL evidence lines */}
              {insight.novelLines.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] uppercase tracking-wide text-white/35">
                    Unknown Patterns (evidence)
                  </div>
                  <div className="space-y-1 rounded-xl border border-white/5 bg-[#0b101a] p-2.5 font-mono text-[10px]">
                    {insight.novelLines.map((e, i) => (
                      <div key={i} className="flex gap-1.5 text-purple-300/80 leading-4">
                        <span className="shrink-0 text-purple-500/60">▸</span>
                        <span className="truncate">{e.line}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {insight.driver === "NONE" && (
                <div className="py-2 text-center text-[11px] text-white/30">
                  {tsd && lsi
                    ? "No anomaly signals detected."
                    : "Waiting for agent data..."}
                </div>
              )}
            </div>

            <div className="rounded-[20px] border border-white/5 bg-[#171e29] p-5">
              <div className="flex items-center gap-2 font-semibold text-white">
                <Activity size={16} />
                Diagnostic Summary
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-white/5 bg-[#0f1420] p-3">
                  <div className="text-[10px] uppercase tracking-wide text-white/35">
                    Detected Issue
                  </div>
                  <div className={`mt-1 text-sm font-semibold ${tones.accent}`}>
                    {message}
                  </div>
                </div>
                <div className="rounded-xl border border-white/5 bg-[#0f1420] p-3">
                  <div className="text-[10px] uppercase tracking-wide text-white/35">
                    Current vs Baseline
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white/80">
                    <span className={tones.accent}>{current}</span>{" "}
                    <span className="text-white/40">vs</span>{" "}
                    <span className="text-white/70">{baseline}</span>
                  </div>
                </div>
                <div className="rounded-xl border border-white/5 bg-[#0f1420] p-3">
                  <div className="text-[10px] uppercase tracking-wide text-white/35">
                    Metric
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white/80">
                    {metric}
                  </div>
                </div>
                <div className="rounded-xl border border-white/5 bg-[#0f1420] p-3">
                  <div className="text-[10px] uppercase tracking-wide text-white/35">
                    Namespace
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white/80">
                    {namespace}
                  </div>
                </div>
              </div>
            </div>

            {/* Agent status card */}
            <div className="rounded-[20px] border border-white/5 bg-[#171e29] p-5">
              <div className="flex items-center gap-2 font-semibold text-white">
                <ShieldAlert size={16} />
                Agent Status
              </div>
              <div className="mt-4 space-y-2 text-[11px]">
                <div className="flex justify-between text-white/60">
                  <span>TSD Drift</span>
                  <span
                    className={
                      tsd?.is_drifting ? "text-red-400" : "text-green-400"
                    }
                  >
                    {tsd?.is_drifting ? "DRIFTING" : "Normal"}
                  </span>
                </div>
                <div className="flex justify-between text-white/60">
                  <span>LSI Anomaly</span>
                  <span
                    className={
                      lsi?.is_anomalous ? "text-red-400" : "text-green-400"
                    }
                  >
                    {lsi?.is_anomalous ? "ANOMALOUS" : "Normal"}
                  </span>
                </div>
                <div className="flex justify-between text-white/60">
                  <span>LSI Model</span>
                  <span
                    className={
                      lsi?.fitted ? "text-green-400" : "text-yellow-400"
                    }
                  >
                    {lsi?.fitted ? "Fitted" : "Training"}
                  </span>
                </div>
                <div className="flex justify-between text-white/60">
                  <span>Readings</span>
                  <span className="text-white/80">
                    {tsd?.readings_count ?? 0}
                  </span>
                </div>
                <div className="flex justify-between text-white/60">
                  <span>Versions</span>
                  <span className="text-white/80">{versions.length}</span>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="rounded-[20px] border border-white/5 bg-[#171e29] p-5">
              <h3 className="text-sm font-semibold text-white mb-3">Actions</h3>
              <div className="space-y-2">
                <Link
                  href="/anomalies"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10 transition"
                >
                  <ArrowLeft size={12} />
                  Back to Terminal
                </Link>
                {stableVersion && (
                  <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3">
                    <div className="flex items-center gap-1.5 text-[11px] text-green-400">
                      <CheckCircle2 size={12} />
                      Rollback Available
                    </div>
                    <div className="mt-1 text-[10px] text-white/50">
                      Stable version {stableVersion.image_tag} ready.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
