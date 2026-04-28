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
  BarChart2,
  Cpu,
  HardDrive,
  Wifi,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

// --- Types ---

type TSDMetrics = {
  current: { cpu_percent: number; memory_mb: number; latency_ms: number; error_rate_percent: number };
  history: { cpu: number[]; memory: number[]; latency: number[]; error_rate: number[] };
  residuals: { cpu: number[]; memory: number[]; latency: number[]; error_rate: number[] };
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

type VersionSnapshot = { id: string; image_tag: string; status: string; created_at: string };

// --- Helpers ---

function severityTone(severity: string) {
  const t = severity.toLowerCase();
  if (t === "critical") return { badge: "bg-red-500/15 text-red-300 border-red-500/30", accent: "text-red-400", dot: "bg-red-400" };
  if (t === "high") return { badge: "bg-orange-500/15 text-orange-300 border-orange-500/30", accent: "text-orange-400", dot: "bg-orange-400" };
  return { badge: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30", accent: "text-yellow-400", dot: "bg-yellow-400" };
}

function decode(value: string | null) { return value ? decodeURIComponent(value) : "unknown"; }

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

type InsightDriver = "TSD_DRIFT" | "LSI_ANOMALOUS" | "BOTH" | "NONE";
type RootCauseInsight = {
  driver: InsightDriver;
  driftingMetrics: Array<{ name: string; lastResidual: number; iqrThreshold: number; ratio: number }>;
  novelRatio: number; errorRatio: number; scoreRatio: number;
  novelLines: Array<{ line: string; timestamp: number }>;
  headline: string; explanation: string;
};

function generateInsight(tsd: TSDMetrics | null, lsi: LSIData | null): RootCauseInsight {
  const empty: RootCauseInsight = {
    driver: "NONE", driftingMetrics: [], novelRatio: 0, errorRatio: 0, scoreRatio: 0, novelLines: [],
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
      if (ratio > 1.0) driftingMetrics.push({ name: def.name, lastResidual, iqrThreshold, ratio });
    }
    driftingMetrics.sort((a, b) => b.ratio - a.ratio);
  }

  const wc = lsi?.window_counts ?? { INFO: 0, WARN: 0, ERROR: 0, NOVEL: 0 };
  const total = Math.max(wc.INFO + wc.WARN + wc.ERROR + wc.NOVEL, 1);
  const novelRatio = wc.NOVEL / total;
  const errorRatio = wc.ERROR / total;
  const scoreRatio = (lsi?.current_score ?? 0) / Math.max(lsi?.threshold ?? 0.0001, 0.0001);
  const novelLines = (lsi?.recent_lines ?? []).filter((e) => e.label === "NOVEL").slice(0, 3).map((e) => ({ line: e.line, timestamp: e.timestamp }));

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
    headline = "Correlated metric drift and anomalous log patterns detected.";
    explanation = topMetric
      ? `${topMetric.name} residuals are ~${topMetric.ratio.toFixed(1)}× above the 3×IQR drift threshold. Simultaneously, ${(novelRatio * 100).toFixed(0)}% of recent log lines are NOVEL patterns. LSI score is ${scoreRatio.toFixed(1)}× the anomaly threshold.`
      : `Both TSD drift and LSI anomaly signals are active. LSI score is ${scoreRatio.toFixed(1)}× the anomaly threshold with ${(novelRatio * 100).toFixed(0)}% NOVEL log lines.`;
  } else if (driver === "TSD_DRIFT") {
    headline = "Metric drift detected — log patterns nominal.";
    explanation = topMetric
      ? `${topMetric.name} residuals are ~${topMetric.ratio.toFixed(1)}× above the 3×IQR threshold after STL decomposition, suggesting a resource regression. Log semantics remain within the trained baseline.`
      : "TSD residuals outside normal bounds. Log semantics remain within trained baseline.";
  } else if (driver === "LSI_ANOMALOUS") {
    headline = "Anomalous log patterns without metric drift.";
    explanation = `LSI score is ${scoreRatio.toFixed(1)}× the anomaly threshold, driven by ${(novelRatio * 100).toFixed(0)}% NOVEL and ${(errorRatio * 100).toFixed(0)}% ERROR log lines. NOVEL lines have cosine similarity < 0.25 to all SVD baseline centroids. CPU, memory, and latency residuals are within normal bounds.`;
  }

  return { driver, driftingMetrics, novelRatio, errorRatio, scoreRatio, novelLines, headline, explanation };
}

// --- Smooth Line Sparkline (for history + LSI score) ---

function SparkLine({
  values,
  threshold,
  baseline,
  lineColor,
  id,
  height = 88,
  unit = "",
}: {
  values: number[];
  threshold?: number;
  baseline?: number;
  lineColor: string;
  id: string;
  height?: number;
  unit?: string;
}) {
  const W = 400; const H = height;
  const P = { t: 8, b: 8, l: 4, r: 4 };
  const iW = W - P.l - P.r; const iH = H - P.t - P.b;

  if (values.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-white/5 bg-[#0b101a] text-[10px] text-white/25"
        style={{ height }}
      >
        Waiting for data…
      </div>
    );
  }

  const allRef = [threshold, baseline].filter((v): v is number => v !== undefined);
  const vMin = Math.min(...values, ...allRef);
  const vMax = Math.max(...values, ...allRef, vMin + 0.001);
  const range = vMax - vMin;

  const toX = (i: number) => P.l + (i / (values.length - 1)) * iW;
  const toY = (v: number) => P.t + (1 - (v - vMin) / range) * iH;

  const pts = values.map((v, i) => ({ x: toX(i), y: toY(v) }));

  let linePath = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const cp = ((pts[i - 1].x + pts[i].x) / 2).toFixed(1);
    linePath += ` C ${cp} ${pts[i - 1].y.toFixed(1)}, ${cp} ${pts[i].y.toFixed(1)}, ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }
  const areaPath = `${linePath} L ${pts.at(-1)!.x.toFixed(1)} ${(H - P.b).toFixed(1)} L ${P.l} ${(H - P.b).toFixed(1)} Z`;

  const thY = threshold !== undefined ? toY(threshold) : null;
  const blY = baseline !== undefined ? toY(baseline) : null;
  const lastPt = pts.at(-1)!;
  const gradId = `spk-${id}`;

  return (
    <div className="rounded-xl border border-white/5 bg-[#0b101a] overflow-hidden" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {thY !== null && (
          <>
            <rect x={P.l} y={thY} width={iW} height={Math.max(0, H - P.b - thY)} fill="rgba(239,68,68,0.04)" />
            <line x1={P.l} y1={thY} x2={W - P.r} y2={thY} stroke="rgba(239,68,68,0.55)" strokeWidth="0.9" strokeDasharray="5,3" />
          </>
        )}
        {blY !== null && (
          <line x1={P.l} y1={blY} x2={W - P.r} y2={blY} stroke="rgba(255,255,255,0.2)" strokeWidth="0.7" strokeDasharray="3,4" />
        )}
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lastPt.x} cy={lastPt.y} r="2.5" fill={lineColor} />
      </svg>
    </div>
  );
}

// --- Residual Sparkline (centered at 0, ±threshold bands) ---

function ResidualSparkline({
  values,
  threshold,
  lineColor,
  id,
  height = 88,
}: {
  values: number[];
  threshold: number;
  lineColor: string;
  id: string;
  height?: number;
}) {
  const W = 400; const H = height;
  const P = { t: 8, b: 8, l: 4, r: 4 };
  const iW = W - P.l - P.r; const iH = H - P.t - P.b;

  if (values.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-white/5 bg-[#0b101a] text-[10px] text-white/25"
        style={{ height }}
      >
        Waiting for data…
      </div>
    );
  }

  const absMax = Math.max(...values.map(Math.abs), threshold, 0.001);
  const vMin = -absMax * 1.2; const vMax = absMax * 1.2;
  const range = vMax - vMin;

  const toX = (i: number) => P.l + (i / (values.length - 1)) * iW;
  const toY = (v: number) => P.t + (1 - (v - vMin) / range) * iH;

  const pts = values.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const zeroY = toY(0);
  const thrTopY = toY(threshold);
  const thrBotY = toY(-threshold);

  let linePath = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const cp = ((pts[i - 1].x + pts[i].x) / 2).toFixed(1);
    linePath += ` C ${cp} ${pts[i - 1].y.toFixed(1)}, ${cp} ${pts[i].y.toFixed(1)}, ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }

  const lastVal = values.at(-1) ?? 0;
  const isHot = threshold > 0 && Math.abs(lastVal) > threshold;
  const stroke = isHot ? "#f87171" : lineColor;
  const gradId = `res-${id}`;

  return (
    <div className="rounded-xl border border-white/5 bg-[#0b101a] overflow-hidden" style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.15" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Safe zone */}
        <rect x={P.l} y={thrTopY} width={iW} height={Math.max(0, thrBotY - thrTopY)} fill="rgba(52,211,153,0.04)" />
        {/* Threshold lines */}
        <line x1={P.l} y1={thrTopY} x2={W - P.r} y2={thrTopY} stroke="rgba(239,68,68,0.45)" strokeWidth="0.8" strokeDasharray="5,3" />
        <line x1={P.l} y1={thrBotY} x2={W - P.r} y2={thrBotY} stroke="rgba(239,68,68,0.45)" strokeWidth="0.8" strokeDasharray="5,3" />
        {/* Zero baseline */}
        <line x1={P.l} y1={zeroY} x2={W - P.r} y2={zeroY} stroke="rgba(255,255,255,0.14)" strokeWidth="0.6" />
        {/* Area fill */}
        <path d={`${linePath} L ${pts.at(-1)!.x.toFixed(1)} ${zeroY.toFixed(1)} L ${pts[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`} fill={`url(#${gradId})`} />
        {/* Line */}
        <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        {/* Last point dot */}
        <circle cx={pts.at(-1)!.x} cy={pts.at(-1)!.y} r="2.5" fill={stroke} />
      </svg>
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
  const [leftTab, setLeftTab] = useState<"tsd" | "lsi">("tsd");

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
        if (metricsRes.ok) { const d = await metricsRes.json(); if (!d.error) setTsd(d); }
        if (lsiRes.ok) { const d = await lsiRes.json(); if (!d.error) setLsi(d); }
        if (versionsRes.ok) { const d = await versionsRes.json(); if (!d.error) setVersions(Array.isArray(d) ? d : []); }
        setAgentOnline(metricsRes.ok || lsiRes.ok);
        setLastUpdate(new Date().toLocaleTimeString());
      } catch { if (active) setAgentOnline(false); }
    };
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [serviceName]);

  const stableVersion = versions.find((v) => v.status === "STABLE");
  const pendingVersion = versions.find((v) => v.status === "PENDING");
  const currentVersion = pendingVersion || versions[0];

  const cpuResiduals = tsd?.residuals.cpu ?? [];
  const memResiduals = tsd?.residuals.memory ?? [];
  const latResiduals = tsd?.residuals.latency ?? [];
  const errResiduals = tsd?.residuals.error_rate ?? [];
  const lastCpuResidual = cpuResiduals.at(-1) ?? 0;
  const lastMemResidual = memResiduals.at(-1) ?? 0;
  const lastLatResidual = latResiduals.at(-1) ?? 0;
  const lastErrResidual = errResiduals.at(-1) ?? 0;

  const scoreHistory = lsi?.score_history ?? [];
  const recentLines = lsi?.recent_lines ?? [];
  const novelLogLines = recentLines.filter((e) => e.label === "NOVEL");
  const otherLogLines = recentLines.filter((e) => e.label !== "NOVEL");

  const insight = generateInsight(tsd, lsi);

  return (
    <div className="h-screen w-full overflow-hidden bg-[#0d1117] text-white flex flex-col">
      {/* Header */}
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#161b22] px-5 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/anomalies" className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition shrink-0">
            <ArrowLeft size={13} />
            Back
          </Link>
          <div className="h-3.5 w-px bg-white/10 shrink-0" />
          <span className="text-sm font-semibold text-white/90 truncate">{serviceName}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] shrink-0 ${tones.badge}`}>{severity.toUpperCase()}</span>
          {(tsd?.is_drifting || lsi?.is_anomalous) && (
            <span className="rounded-full bg-red-500/10 border border-red-500/25 px-2 py-0.5 text-[10px] text-red-300 shrink-0 animate-pulse">
              ● ANOMALY
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] shrink-0">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${agentOnline ? "bg-green-500/10 text-green-300" : "bg-red-500/10 text-red-300"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${agentOnline ? "bg-green-400" : "bg-red-400"}`} />
            Agent {agentOnline ? "Online" : "Offline"}
          </span>
          {lastUpdate && <span className="text-white/35">Updated {lastUpdate}</span>}
        </div>
      </header>

      {/* Offline banner */}
      {!agentOnline && !tsd && !lsi && (
        <div className="flex shrink-0 items-center gap-3 border-b border-red-500/20 bg-red-500/[0.05] px-5 py-2">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
          <p className="text-[11px] text-red-300">
            <span className="font-medium">Agent offline</span>{" — "}TSD · LSI · auto-rollback unavailable. Run{" "}
            <code className="font-mono text-[10px] text-red-200">
              BACKTRACK_TARGET=&lt;app&gt; python3 -m uvicorn src.main:app --port 9090
            </code>
          </p>
        </div>
      )}

      {/* Body — 3 columns */}
      <div className="flex flex-1 min-h-0 overflow-hidden gap-3 p-3">

        {/* ── LEFT PANEL: tabbed TSD / LSI ── */}
        <div className="w-[400px] shrink-0 flex flex-col gap-2 min-h-0">

          {/* Status + version row */}
          <div className="grid grid-cols-2 gap-2 shrink-0">
            <div className={`rounded-xl border border-white/[0.06] bg-[#161b22] px-3 py-2.5 flex items-center gap-2`}>
              <span className={`text-[11px] font-bold tracking-wide ${tsd?.is_drifting || lsi?.is_anomalous ? tones.accent : "text-emerald-400"}`}>
                {tsd?.is_drifting || lsi?.is_anomalous ? "ANOMALY DETECTED" : "SYSTEM NOMINAL"}
              </span>
              {tsd?.is_drifting && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300">TSD</span>}
              {lsi?.is_anomalous && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300">LSI</span>}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-xl border border-white/[0.06] bg-[#161b22] px-2 py-2">
                <div className="text-[9px] uppercase tracking-wide text-white/35">Current</div>
                <div className={`mt-0.5 text-xs font-bold truncate ${tones.accent}`}>{currentVersion?.image_tag || "N/A"}</div>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-[#161b22] px-2 py-2">
                <div className="text-[9px] uppercase tracking-wide text-white/35">Stable</div>
                <div className="mt-0.5 text-xs font-bold text-emerald-400 truncate">{stableVersion?.image_tag || "N/A"}</div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1.5 shrink-0">
            {([
              { id: "tsd" as const, label: "Time Series Decomposition", icon: <BarChart2 size={12} /> },
              { id: "lsi" as const, label: "Latent Semantic Indexing", icon: <Activity size={12} /> },
            ]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setLeftTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] transition border flex-1 justify-center ${
                  leftTab === tab.id
                    ? "bg-[rgba(94,234,212,0.08)] border-[rgba(94,234,212,0.3)] text-[#5eead4]"
                    : "bg-[#161b22] border-white/[0.06] text-white/40 hover:text-white/60 hover:border-white/15"
                }`}
              >
                {tab.icon}
                {tab.id === "tsd" ? "TSD" : "LSI"}
                {tab.id === "tsd" && tsd?.is_drifting && <span className="w-1.5 h-1.5 rounded-full bg-red-400 ml-0.5" />}
                {tab.id === "lsi" && lsi?.is_anomalous && <span className="w-1.5 h-1.5 rounded-full bg-orange-400 ml-0.5" />}
              </button>
            ))}
          </div>

          {/* Tab content — scrollable */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-3 scrollbar-hide">

            {/* ─── TSD TAB ─── */}
            {leftTab === "tsd" && (
              <>
                {/* Current metrics */}
                <div className="rounded-2xl border border-white/[0.06] bg-[#161b22] p-3">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Live Metrics</span>
                    <span className="text-[10px] text-white/25">{tsd?.readings_count ?? 0} readings</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { label: "CPU", value: `${tsd?.current.cpu_percent.toFixed(1) ?? "—"}%`, color: "text-emerald-400" },
                      { label: "Memory", value: `${tsd?.current.memory_mb.toFixed(1) ?? "—"} MB`, color: "text-sky-400" },
                      { label: "Latency", value: `${tsd?.current.latency_ms.toFixed(0) ?? "—"} ms`, color: "text-violet-400" },
                      { label: "Err Rate", value: `${tsd?.current.error_rate_percent.toFixed(2) ?? "—"}%`, color: "text-rose-400" },
                    ].map((s) => (
                      <div key={s.label} className="rounded-lg border border-white/[0.05] bg-[#0d1117] p-2 text-center">
                        <div className="text-[9px] uppercase tracking-wide text-white/30">{s.label}</div>
                        <div className={`mt-0.5 text-xs font-bold ${s.color}`}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Residual values */}
                <div className="rounded-2xl border border-white/[0.06] bg-[#161b22] p-3">
                  <div className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">Residuals</div>
                  <div className="grid grid-cols-4 gap-1.5 mb-3">
                    {[
                      { label: "CPU", value: lastCpuResidual, thr: 3 * estimateIQR(cpuResiduals) },
                      { label: "Mem", value: lastMemResidual, thr: 3 * estimateIQR(memResiduals) },
                      { label: "Lat", value: lastLatResidual, thr: 3 * estimateIQR(latResiduals) },
                      { label: "Err", value: lastErrResidual, thr: 3 * estimateIQR(errResiduals) },
                    ].map((r) => {
                      const hot = r.thr > 0 && Math.abs(r.value) > r.thr;
                      return (
                        <div key={r.label} className="rounded-lg border border-white/[0.05] bg-[#0d1117] p-2 text-center">
                          <div className="text-[9px] uppercase tracking-wide text-white/30">{r.label}</div>
                          <div className={`mt-0.5 text-xs font-bold ${hot ? "text-red-400" : "text-emerald-400"}`}>
                            {(r.value > 0 ? "+" : "") + r.value.toFixed(3)}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* 4 residual sparklines */}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "CPU Residuals", values: cpuResiduals, last: lastCpuResidual, thr: 3 * estimateIQR(cpuResiduals), lineColor: "#6ee7b7", id: "cpu-res" },
                      { label: "Memory Residuals", values: memResiduals, last: lastMemResidual, thr: 3 * estimateIQR(memResiduals), lineColor: "#7dd3fc", id: "mem-res" },
                      { label: "Latency Residuals", values: latResiduals, last: lastLatResidual, thr: 3 * estimateIQR(latResiduals), lineColor: "#c4b5fd", id: "lat-res" },
                      { label: "Error Rate Residuals", values: errResiduals, last: lastErrResidual, thr: 3 * estimateIQR(errResiduals), lineColor: "#fca5a5", id: "err-res" },
                    ].map((c) => (
                      <div key={c.label}>
                        <div className="mb-1 flex items-center justify-between text-[9px]">
                          <span className="text-white/35">{c.label}</span>
                          <span className="font-mono text-white/35">{(c.last > 0 ? "+" : "") + c.last.toFixed(3)}</span>
                        </div>
                        <ResidualSparkline
                          values={c.values}
                          threshold={c.thr}
                          lineColor={c.lineColor}
                          id={c.id}
                          height={80}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Memory History */}
                <div className="rounded-2xl border border-white/[0.06] bg-[#161b22] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                      <HardDrive size={11} className="text-sky-400" />
                      Memory History
                    </div>
                    <span className="text-[10px] font-mono text-sky-400">{tsd?.history.memory.at(-1)?.toFixed(1) ?? "—"} MB</span>
                  </div>
                  <SparkLine
                    values={tsd?.history.memory ?? []}
                    lineColor="#7dd3fc"
                    id="mem-hist"
                    height={80}
                    unit="MB"
                  />
                </div>

                {/* Latency History */}
                <div className="rounded-2xl border border-white/[0.06] bg-[#161b22] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                      <Wifi size={11} className="text-violet-400" />
                      Latency History
                    </div>
                    <span className="text-[10px] font-mono text-violet-400">{tsd?.history.latency.at(-1)?.toFixed(0) ?? "—"} ms</span>
                  </div>
                  <SparkLine
                    values={tsd?.history.latency ?? []}
                    lineColor="#c4b5fd"
                    id="lat-hist"
                    height={80}
                    unit="ms"
                  />
                </div>

                {/* TSD Status */}
                <div className="rounded-xl border border-white/[0.05] bg-[#0d1117] px-3 py-2.5 text-[11px] leading-5 text-white/60">
                  <span className="font-semibold text-white/80">TSD Status: </span>
                  {tsd?.is_drifting ? (
                    <span className="text-red-400">Residual drift detected — anomalous readings exceed 3×IQR on {tsd.readings_count} readings.</span>
                  ) : tsd ? (
                    <span className="text-emerald-400">All residuals within normal bounds.{tsd.readings_count < 12 && ` Warming up (${tsd.readings_count}/12 readings).`}</span>
                  ) : (
                    <span className="text-white/30">Waiting for agent connection...</span>
                  )}
                </div>
              </>
            )}

            {/* ─── LSI TAB ─── */}
            {leftTab === "lsi" && (
              <>
                {/* Score + Baseline */}
                <div className="rounded-2xl border border-white/[0.06] bg-[#161b22] p-3">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">LSI Scores</span>
                    <span className="text-[10px] text-white/25">{lsi?.fitted ? "Model Active" : `Corpus ${lsi?.corpus_size ?? 0} lines`}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 mb-3">
                    <div className="rounded-lg border border-white/[0.05] bg-[#0d1117] p-2.5">
                      <div className="text-[9px] uppercase tracking-wide text-white/30">Current Score</div>
                      <div className={`mt-0.5 text-base font-bold ${lsi?.is_anomalous ? "text-red-400" : "text-cyan-300"}`}>
                        {lsi?.current_score.toFixed(4) ?? "—"}
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/[0.05] bg-[#0d1117] p-2.5">
                      <div className="text-[9px] uppercase tracking-wide text-white/30">Baseline Mean</div>
                      <div className="mt-0.5 text-base font-bold text-white/75">{lsi?.baseline_mean.toFixed(4) ?? "—"}</div>
                    </div>
                    <div className="rounded-lg border border-white/[0.05] bg-[#0d1117] p-2.5">
                      <div className="text-[9px] uppercase tracking-wide text-white/30">Threshold</div>
                      <div className="mt-0.5 text-base font-bold text-red-300/80">{lsi?.threshold.toFixed(4) ?? "—"}</div>
                    </div>
                  </div>

                  {lsi?.fitted && (
                    <div className="grid grid-cols-4 gap-1.5">
                      {(["INFO", "WARN", "ERROR", "NOVEL"] as const).map((label) => {
                        const colors: Record<string, string> = { INFO: "text-emerald-400", WARN: "text-yellow-400", ERROR: "text-red-400", NOVEL: "text-purple-400" };
                        return (
                          <div key={label} className="rounded-lg border border-white/[0.05] bg-[#0d1117] p-2 text-center">
                            <div className="text-[9px] uppercase tracking-wide text-white/30">{label}</div>
                            <div className={`mt-0.5 text-sm font-bold ${colors[label]}`}>{lsi.window_counts[label] ?? 0}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Score History */}
                <div className="rounded-2xl border border-white/[0.06] bg-[#161b22] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
                      <TrendingUp size={11} className="text-cyan-400" />
                      Score History
                    </div>
                    <div className="flex items-center gap-2 text-[9px]">
                      <span className="text-white/30">Baseline</span>
                      <span className="font-mono text-white/50">{lsi?.baseline_mean.toFixed(3) ?? "—"}</span>
                      <span className="text-red-400/60">Threshold {lsi?.threshold.toFixed(3) ?? "—"}</span>
                    </div>
                  </div>
                  <SparkLine
                    values={scoreHistory}
                    threshold={lsi?.threshold}
                    baseline={lsi?.baseline_mean}
                    lineColor="#67e8f9"
                    id="lsi-score"
                    height={90}
                  />
                  <div className="mt-2 flex items-center gap-4 text-[9px] text-white/30">
                    <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-dashed border-red-400/60" /> Threshold</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-dashed border-white/25" /> Baseline mean</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-cyan-400" /> Current score</span>
                  </div>
                </div>

                {/* Recent lines */}
                {lsi && lsi.recent_lines.length > 0 && (
                  <div className="rounded-2xl border border-white/[0.06] bg-[#161b22] p-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-white/40">Recent Window Lines</div>
                    <div className="space-y-0.5 font-mono text-[10px] max-h-[160px] overflow-y-auto scrollbar-hide">
                      {lsi.recent_lines.slice(-30).map((entry, i) => {
                        const colors: Record<string, string> = { INFO: "text-emerald-400", WARN: "text-yellow-400", ERROR: "text-red-400", NOVEL: "text-purple-400" };
                        return (
                          <div key={i} className="flex gap-2">
                            <span className={`shrink-0 w-10 text-right font-bold ${colors[entry.label] ?? "text-white/40"}`}>{entry.label}</span>
                            <span className="text-white/50 truncate">{entry.line}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* LSI status */}
                <div className="rounded-xl border border-white/[0.05] bg-[#0d1117] px-3 py-2.5 text-[11px] leading-5 text-white/60">
                  <span className="font-semibold text-white/80">LSI Status: </span>
                  {lsi?.is_anomalous ? (
                    <span className="text-red-400">Anomalous — score {lsi.current_score.toFixed(4)} exceeds {lsi.threshold.toFixed(4)} threshold ({lsi.baseline_mean.toFixed(4)} × {(lsi.threshold / Math.max(lsi.baseline_mean, 0.0001)).toFixed(1)}).</span>
                  ) : lsi?.fitted ? (
                    <span className="text-emerald-400">Log patterns within normal baseline.</span>
                  ) : (
                    <span className="text-white/30">{lsi ? `Building corpus (${lsi.corpus_size}/200 lines)...` : "Waiting for agent connection..."}</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── CENTER: Insights + Log Stream ── */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0 gap-3">

          {/* ── Log Stream ── */}
          <div className="flex-1 min-h-0 rounded-2xl border border-white/[0.06] bg-[#161b22] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-white/40">Classified Log Stream</span>
              <div className="flex items-center gap-3 text-[9px] text-white/25">
                {lsi && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-purple-400">{lsi.window_counts.NOVEL} novel</span>
                    <span className="text-red-400">{lsi.window_counts.ERROR} error</span>
                    <span className="text-yellow-400">{lsi.window_counts.WARN} warn</span>
                    <span className="text-emerald-400">{lsi.window_counts.INFO} info</span>
                  </span>
                )}
                <span>{recentLines.length} lines (live)</span>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3 font-mono text-xs leading-5 bg-[#0d1117] scrollbar-hide">
              {recentLines.length === 0 ? (
                <div className="flex items-center justify-center h-full text-white/25 text-[11px]">
                  {agentOnline ? "Waiting for classified log lines..." : "Connect backtrack-agent to see classified logs."}
                </div>
              ) : (
                <>
                  {novelLogLines.length > 0 && (
                    <>
                      <div className="mb-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-purple-400/60">
                        <span className="h-px flex-1 bg-purple-500/15" />Unknown Patterns ({novelLogLines.length})
                        <span className="h-px flex-1 bg-purple-500/15" />
                      </div>
                      {novelLogLines.map((entry, i) => (
                        <div key={`novel-${i}`} className="flex gap-2 py-0.5 rounded bg-purple-500/[0.04]">
                          <span className="shrink-0 w-12 text-right font-bold text-purple-400">NOVEL</span>
                          <span className="text-purple-200/65 truncate">{entry.line}</span>
                        </div>
                      ))}
                      {otherLogLines.length > 0 && (
                        <div className="my-2 flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-white/20">
                          <span className="h-px flex-1 bg-white/[0.05]" />Classified Lines ({otherLogLines.length})
                          <span className="h-px flex-1 bg-white/[0.05]" />
                        </div>
                      )}
                    </>
                  )}
                  {otherLogLines.map((entry, i) => {
                    const labelColors: Record<string, string> = { ERROR: "text-red-400", WARN: "text-yellow-400", INFO: "text-emerald-400" };
                    return (
                      <div key={`line-${i}`} className="flex gap-2 py-0.5">
                        <span className={`shrink-0 w-12 text-right font-bold ${labelColors[entry.label] ?? "text-white/40"}`}>{entry.label}</span>
                        <span className="text-white/55 truncate">{entry.line}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <aside className="w-[256px] shrink-0 flex flex-col gap-3 overflow-y-auto scrollbar-hide">

          {/* Root Cause Analysis */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#161b22] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Search size={14} className="text-white/50" />
              <span className="font-semibold text-sm text-white">Root Cause</span>
              {insight.driver !== "NONE" && (
                <span className="ml-auto rounded-full border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 text-[9px] text-orange-300">ACTIVE</span>
              )}
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-[#0d1117] p-2.5 mb-2.5">
              <div className="text-[9px] uppercase tracking-wide text-white/30 mb-1">Analysis</div>
              <div className="text-[11px] leading-5 text-white/75">{insight.headline}</div>
            </div>
            <p className="text-[10px] leading-[1.65] text-white/45 mb-2.5">{insight.explanation}</p>
            {insight.driftingMetrics.length > 0 && (
              <div className="space-y-1 mb-2.5">
                <div className="text-[9px] uppercase tracking-wide text-white/30 mb-1">Metric Drift</div>
                {insight.driftingMetrics.map((m) => (
                  <div key={m.name} className="flex items-center justify-between rounded-lg border border-red-500/15 bg-red-500/[0.04] px-2.5 py-1.5">
                    <span className="text-[10px] text-white/55">{m.name} residual</span>
                    <span className="text-[10px] font-bold text-red-400">~{m.ratio.toFixed(1)}×</span>
                  </div>
                ))}
              </div>
            )}
            {lsi?.is_anomalous && (
              <div className="flex items-center justify-between rounded-lg border border-purple-500/15 bg-purple-500/[0.04] px-2.5 py-1.5 mb-2.5">
                <span className="text-[10px] text-white/55">NOVEL log ratio</span>
                <span className="text-[10px] font-bold text-purple-400">{(insight.novelRatio * 100).toFixed(0)}% of window</span>
              </div>
            )}
            {insight.novelLines.length > 0 && (
              <div>
                <div className="text-[9px] uppercase tracking-wide text-white/30 mb-1.5">Unknown Patterns</div>
                <div className="space-y-1 rounded-xl border border-white/[0.05] bg-[#0d1117] p-2 font-mono text-[9px]">
                  {insight.novelLines.map((e, i) => (
                    <div key={i} className="flex gap-1.5 text-purple-300/70 leading-4">
                      <span className="shrink-0 text-purple-500/50">▸</span>
                      <span className="truncate">{e.line}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {insight.driver === "NONE" && (
              <div className="text-center text-[10px] text-white/25 py-2">{tsd && lsi ? "No anomaly signals detected." : "Waiting for agent data..."}</div>
            )}
          </div>

          {/* Diagnostic Summary */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#161b22] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity size={14} className="text-white/50" />
              <span className="font-semibold text-sm text-white">Diagnostic Summary</span>
            </div>
            <div className="space-y-2 text-[11px]">
              {[
                { label: "Detected Issue", value: message, color: tones.accent },
                { label: "Current vs Baseline", value: `${current} vs ${baseline}`, color: "text-white/70" },
                { label: "Metric", value: metric, color: "text-white/70" },
                { label: "Namespace", value: namespace, color: "text-white/70" },
              ].map((row) => (
                <div key={row.label} className="rounded-lg border border-white/[0.05] bg-[#0d1117] px-2.5 py-2">
                  <div className="text-[9px] uppercase tracking-wide text-white/30">{row.label}</div>
                  <div className={`mt-0.5 text-[11px] font-semibold ${row.color}`}>{row.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Agent Status */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#161b22] p-4">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert size={14} className="text-white/50" />
              <span className="font-semibold text-sm text-white">Agent Status</span>
            </div>
            <div className="space-y-1.5 text-[11px]">
              {[
                { label: "TSD Drift", value: tsd?.is_drifting ? "DRIFTING" : "Normal", hot: !!tsd?.is_drifting },
                { label: "LSI Anomaly", value: lsi?.is_anomalous ? "ANOMALOUS" : "Normal", hot: !!lsi?.is_anomalous },
                { label: "LSI Model", value: lsi?.fitted ? "Fitted" : "Training", hot: !lsi?.fitted },
                { label: "Readings", value: String(tsd?.readings_count ?? 0), hot: false },
                { label: "Versions", value: String(versions.length), hot: false },
              ].map((row) => (
                <div key={row.label} className="flex justify-between text-white/50">
                  <span>{row.label}</span>
                  <span className={row.hot ? "text-red-400" : row.label === "LSI Model" && lsi?.fitted ? "text-emerald-400" : "text-emerald-400"}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#161b22] p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Actions</h3>
            <div className="space-y-2">
              <Link
                href="/anomalies"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70 hover:bg-white/[0.08] transition"
              >
                <ArrowLeft size={12} />
                Back to Terminal
              </Link>
              {stableVersion && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                    <CheckCircle2 size={12} />
                    Rollback Available
                  </div>
                  <div className="mt-1 text-[10px] text-white/40">Stable version {stableVersion.image_tag} ready.</div>
                </div>
              )}
            </div>
          </div>

        </aside>
      </div>
    </div>
  );
}
