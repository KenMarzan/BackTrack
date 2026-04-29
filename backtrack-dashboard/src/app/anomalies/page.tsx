"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Activity, AlertTriangle, BarChart2, Cpu, HardDrive, ScrollText, Server, TrendingUp, Wifi, Zap } from "lucide-react";
import Nav from "../components/Nav";

const KubernetesTerminal = dynamic(() => import("./KubernetesTerminal"), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-sm">
      Loading terminal...
    </div>
  ),
});

type TSDDecompComponent = { seasonal: number[]; trend: number[]; residual: number[] };

type TSDSummary = {
  current: {
    cpu_percent: number;
    memory_mb: number;
    latency_ms: number;
    error_rate_percent: number;
  };
  decomposition?: {
    cpu_percent: TSDDecompComponent;
    memory_mb:   TSDDecompComponent;
    latency_ms:  TSDDecompComponent;
    error_rate_percent: TSDDecompComponent;
  };
  readings_count: number;
  is_drifting: boolean;
};

type LSILogLine = {
  line: string;
  label: "INFO" | "WARN" | "ERROR" | "NOVEL";
  timestamp: number;
};

type LSISummary = {
  fitted: boolean;
  corpus_size: number;
  current_score: number;
  baseline_mean: number;
  threshold: number;
  is_anomalous: boolean;
  score_history: number[];
  recent_lines: LSILogLine[];
};

const LOG_LABEL_TOKENS: Record<string, { text: string; border: string; bg: string }> = {
  ERROR: { text: "#fca5a5", border: "rgba(251,113,133,0.35)", bg: "rgba(251,113,133,0.08)" },
  NOVEL: { text: "#fcd34d", border: "rgba(251,191,36,0.35)",  bg: "rgba(251,191,36,0.08)" },
  WARN:  { text: "#fde68a", border: "rgba(253,224,71,0.30)",  bg: "rgba(253,224,71,0.06)" },
  INFO:  { text: "rgba(255,255,255,0.35)", border: "rgba(148,163,184,0.15)", bg: "rgba(148,163,184,0.04)" },
};

const TSD_METRICS = [
  { key: "cpu_percent",        label: "CPU",        color: "var(--accent-green)",  Icon: Cpu,          fmt: (v: number) => `${v.toFixed(1)}%` },
  { key: "memory_mb",          label: "Memory",     color: "var(--accent-cyan)",   Icon: HardDrive,    fmt: (v: number) => `${v.toFixed(1)} MB` },
  { key: "latency_ms",         label: "Latency",    color: "var(--accent-violet)", Icon: Wifi,         fmt: (v: number) => `${v.toFixed(0)} ms` },
  { key: "error_rate_percent", label: "Error Rate", color: "var(--accent-rose)",   Icon: AlertTriangle,fmt: (v: number) => `${v.toFixed(2)}%` },
] as const;

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const W = 60; const H = 18; const P = 2;
  const min = Math.min(...values); const max = Math.max(...values);
  const range = Math.max(max - min, 0.001);
  const toX = (i: number) => P + (i / (values.length - 1)) * (W - P * 2);
  const toY = (v: number) => H - P - ((v - min) / range) * (H - P * 2);
  let d = `M ${toX(0).toFixed(1)} ${toY(values[0]).toFixed(1)}`;
  for (let i = 1; i < values.length; i++) {
    const cp = ((toX(i - 1) + toX(i)) / 2).toFixed(1);
    d += ` C ${cp} ${toY(values[i - 1]).toFixed(1)}, ${cp} ${toY(values[i]).toFixed(1)}, ${toX(i).toFixed(1)} ${toY(values[i]).toFixed(1)}`;
  }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

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
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const agentOffline = !agentOnline && !tsd && !lsi;

  return (
    <div className="w-full h-screen flex flex-col overflow-hidden">
      <Nav />

      <div className="flex-1 min-h-0 grid grid-cols-3 gap-4 p-6 overflow-hidden">

        {/* ── Terminal (2/3) ── */}
        <div className="col-span-2 bt-panel flex flex-col overflow-hidden p-5 min-h-0">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Server size={14} className="text-[var(--accent-teal)]" />
            <span className="bt-label">Terminal</span>
            <div className="bt-pulse-dot ml-auto" />
            <span className="text-[10px] text-[var(--text-muted)] bt-mono">kubectl · production-us-east</span>
          </div>
          <div className="bt-card-divider flex-shrink-0" />
          <div className="flex-1 min-h-0">
            <KubernetesTerminal />
          </div>
        </div>

        {/* ── Right panels (1/3) ── */}
        <div className="col-span-1 flex flex-col gap-4 min-h-0 overflow-hidden">

          {/* Agent offline */}
          {agentOffline && (
            <div className="flex-1 bt-panel flex flex-col items-center justify-center gap-4 p-6 text-center"
              style={{ borderColor: "rgba(251,113,133,0.25)", background: "rgba(251,113,133,0.04)" }}>
              <div className="h-11 w-11 rounded-full border flex items-center justify-center"
                style={{ borderColor: "rgba(251,113,133,0.35)", background: "rgba(251,113,133,0.10)" }}>
                <Activity size={18} className="text-[var(--accent-rose)]" />
              </div>
              <div>
                <p className="text-[var(--text-primary)] font-semibold text-sm">Agent offline</p>
                <p className="text-[var(--text-muted)] text-[11px] mt-1">TSD · LSI · auto-rollback unavailable</p>
              </div>
              <div className="w-full rounded-lg border border-[var(--border-soft)] bg-black/30 px-3 py-2 text-left">
                <p className="text-[9px] uppercase tracking-widest text-[var(--text-muted)] mb-1">Start agent</p>
                <code className="bt-mono text-[10px] text-[var(--accent-teal)] whitespace-pre-wrap break-all leading-relaxed">
                  cd backtrack-agent{"\n"}pip install -r requirements.txt{"\n"}python3 -m uvicorn src.main:app --port 9090
                </code>
              </div>
            </div>
          )}

          {/* TSD Panel */}
          {!agentOffline && (
            <div className="bt-panel flex-1 flex flex-col overflow-hidden p-4">
              <div className="flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <BarChart2 size={13} className="text-[var(--accent-teal)]" />
                  <span className="bt-label">TSD Metrics</span>
                </div>
                <span className={`bt-chip ${tsd?.is_drifting ? "bt-chip-critical" : "bt-chip-green"}`}>
                  {tsd?.is_drifting ? "DRIFTING" : agentOnline ? "NORMAL" : "OFFLINE"}
                </span>
              </div>
              <div className="bt-card-divider flex-shrink-0" />

              {tsd ? (
                <div className="flex-1 overflow-y-auto scrollbar-hide space-y-2.5">
                  {/* Metric tiles with icons + trend sparkline */}
                  {TSD_METRICS.map((m) => {
                    const decomp = tsd.decomposition?.[m.key];
                    const lastTrend    = decomp?.trend.at(-1);
                    const lastSeasonal = decomp?.seasonal.at(-1);
                    const lastResidual = decomp?.residual.at(-1);
                    return (
                      <div key={m.label} className="rounded-[10px] border border-[var(--border-soft)] bg-[rgba(11,16,32,0.9)] px-3 py-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <m.Icon size={10} style={{ color: m.color }} />
                            <span className="text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)]">{m.label}</span>
                          </div>
                          {decomp && <MiniSparkline values={decomp.trend.slice(-20)} color={m.color} />}
                        </div>
                        <div className="bt-mono text-[17px] font-semibold" style={{ color: m.color }}>
                          {m.fmt(tsd.current[m.key])}
                        </div>
                        {decomp && (
                          <div className="flex items-center gap-3 mt-1.5">
                            <span className="text-[8.5px] text-[var(--text-muted)] bt-mono flex items-center gap-1">
                              <TrendingUp size={8} style={{ color: m.color, opacity: 0.6 }} />
                              T {lastTrend !== undefined ? lastTrend.toFixed(2) : "—"}
                            </span>
                            <span className="text-[8.5px] text-[var(--text-muted)] bt-mono flex items-center gap-1">
                              <Zap size={8} style={{ opacity: 0.4 }} />
                              S {lastSeasonal !== undefined ? lastSeasonal.toFixed(2) : "—"}
                            </span>
                            <span className="text-[8.5px] text-[var(--text-muted)] bt-mono flex items-center gap-1">
                              <Activity size={8} style={{ opacity: 0.4 }} />
                              R {lastResidual !== undefined ? lastResidual.toFixed(3) : "—"}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* STL progress */}
                  <div className="rounded-[10px] border border-[var(--border-soft)] bg-[rgba(11,16,32,0.9)] px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)] flex items-center gap-1.5">
                        <BarChart2 size={9} />STL Baseline
                      </span>
                      <span className="bt-mono text-[9px] text-[var(--text-muted)]">{tsd.readings_count}/12</span>
                    </div>
                    <div className="h-[3px] w-full rounded-full bg-[rgba(148,163,184,0.1)] overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{
                        width: `${Math.min((tsd.readings_count / 12) * 100, 100)}%`,
                        background: tsd.readings_count >= 12 ? "var(--accent-teal)" : "rgba(94,234,212,0.5)",
                      }} />
                    </div>
                    <p className="text-[9px] text-[var(--text-muted)] bt-mono mt-1">
                      {tsd.readings_count >= 12 ? "Decomposition active — Season · Trend · Residual" : `${12 - tsd.readings_count} more readings needed`}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-[12px] text-[var(--text-muted)]">
                    {agentOnline ? "Loading metrics…" : "Agent offline"}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* LSI Panel */}
          {!agentOffline && (
            <div className="bt-panel flex-1 flex flex-col overflow-hidden p-4">
              <div className="flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Cpu size={13} className="text-[var(--accent-violet)]" />
                  <span className="bt-label">LSI Analysis</span>
                </div>
                <span className={`bt-chip ${lsi?.is_anomalous ? "bt-chip-critical" : "bt-chip-green"}`}>
                  {lsi?.is_anomalous ? "ANOMALOUS" : agentOnline ? "NORMAL" : "OFFLINE"}
                </span>
              </div>
              <div className="bt-card-divider flex-shrink-0" />

              {lsi ? (
                <div className="flex-1 overflow-y-auto scrollbar-hide space-y-3">
                  {/* Score + threshold tiles */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-[10px] border border-[var(--border-soft)] bg-[rgba(11,16,32,0.9)] p-3">
                      <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Score</div>
                      <div className="bt-mono text-[15px] font-semibold mt-1"
                        style={{ color: lsi.is_anomalous ? "var(--accent-rose)" : "var(--accent-cyan)" }}>
                        {lsi.current_score.toFixed(4)}
                      </div>
                    </div>
                    <div className="rounded-[10px] border border-[var(--border-soft)] bg-[rgba(11,16,32,0.9)] p-3">
                      <div className="text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Threshold</div>
                      <div className="bt-mono text-[15px] font-semibold mt-1 text-[var(--text-secondary)]">
                        {lsi.threshold.toFixed(4)}
                      </div>
                    </div>
                  </div>

                  {/* Score vs threshold bar */}
                  {lsi.threshold > 0 && (() => {
                    const ratio = Math.min(lsi.current_score / lsi.threshold, 1.5);
                    const pct = Math.min((ratio / 1.5) * 100, 100);
                    const barColor = lsi.is_anomalous ? "#fb7185" : "#67e8f9";
                    return (
                      <div className="rounded-[10px] border border-[var(--border-soft)] bg-[rgba(11,16,32,0.9)] px-3 py-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[9px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Score / Threshold</span>
                          <span className="bt-mono text-[9px]" style={{ color: barColor }}>
                            {(ratio * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-[3px] w-full rounded-full bg-[rgba(148,163,184,0.1)] overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${pct}%`, background: barColor }} />
                        </div>
                        {/* threshold tick */}
                        <div className="relative h-0">
                          <div className="absolute" style={{ left: `${(1 / 1.5) * 100}%`, top: -3, transform: "translateX(-50%)" }}>
                            <div className="w-px h-2 bg-[rgba(251,113,133,0.5)]" />
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Anomaly Score History chart */}
                  {lsi.score_history.length > 1 && (() => {
                    const pts = lsi.score_history.slice(-30);
                    const maxV = Math.max(...pts, lsi.threshold, 0.1);
                    const W = 300, H = 72, pad = 4;
                    const toX = (i: number) => pad + (i / (pts.length - 1)) * (W - pad * 2);
                    const toY = (v: number) => H - pad - ((v / maxV) * (H - pad * 2));
                    let line = `M ${toX(0).toFixed(1)} ${toY(pts[0]).toFixed(1)}`;
                    for (let i = 1; i < pts.length; i++) {
                      const cp = ((toX(i - 1) + toX(i)) / 2).toFixed(1);
                      line += ` C ${cp} ${toY(pts[i - 1]).toFixed(1)}, ${cp} ${toY(pts[i]).toFixed(1)}, ${toX(i).toFixed(1)} ${toY(pts[i]).toFixed(1)}`;
                    }
                    const area = `${line} L ${toX(pts.length - 1).toFixed(1)} ${H} L ${toX(0).toFixed(1)} ${H} Z`;
                    const thY = toY(lsi.threshold).toFixed(1);
                    const hot = lsi.is_anomalous;
                    const lineColor = hot ? "#fb7185" : "#67e8f9";
                    const fillId = "lsi-score-fill";
                    return (
                      <div className="rounded-[10px] border border-[var(--border-soft)] bg-[rgba(7,9,13,0.85)] p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Score History</p>
                          <p className="bt-mono text-[9px] text-[var(--text-muted)]">
                            {lsi.fitted ? `baseline ${lsi.baseline_mean.toFixed(2)}` : `corpus ${lsi.corpus_size}/200`}
                          </p>
                        </div>
                        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block", height: 60 }}>
                          <defs>
                            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={lineColor} stopOpacity="0.30" />
                              <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          {lsi.threshold > 0 && (
                            <>
                              <line x1={pad} y1={thY} x2={W - pad} y2={thY}
                                stroke="rgba(251,113,133,0.45)" strokeWidth="1" strokeDasharray="4 3" />
                              <text x={W - pad - 2} y={+thY - 3} fontSize="7" fill="rgba(251,113,133,0.6)"
                                fontFamily="'IBM Plex Mono',monospace" textAnchor="end">
                                limit
                              </text>
                            </>
                          )}
                          <path d={area} fill={`url(#${fillId})`} />
                          <path d={line} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    );
                  })()}

                  {/* Recent / Anomalous log lines */}
                  {lsi.recent_lines && lsi.recent_lines.length > 0 && (
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-muted)] mb-1.5">
                        {lsi.is_anomalous ? "Anomalous lines" : "Recent lines"}
                      </p>
                      <div className="space-y-[3px] max-h-[160px] overflow-y-auto scrollbar-hide">
                        {(lsi.is_anomalous
                          ? lsi.recent_lines.filter((l) => l.label === "ERROR" || l.label === "NOVEL")
                          : lsi.recent_lines.slice(-10)
                        ).slice(-12).map((entry, i) => {
                          const tk = LOG_LABEL_TOKENS[entry.label] ?? LOG_LABEL_TOKENS.INFO;
                          const ageStr = new Date(entry.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                          return (
                            <div key={i} className="rounded-[8px] border border-[var(--border-soft)] bg-[rgba(148,163,184,0.02)] px-2 py-1.5">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="shrink-0 text-[9px] px-1 py-[1px] rounded border bt-mono"
                                  style={{ color: tk.text, borderColor: tk.border, background: tk.bg }}>
                                  {entry.label}
                                </span>
                                <span className="shrink-0 text-[9px] text-[var(--text-muted)] bt-mono ml-auto">{ageStr}</span>
                              </div>
                              <p className="text-[10px] text-[var(--text-muted)] bt-mono leading-[1.5] break-all">
                                {entry.line.slice(0, 120)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-[12px] text-[var(--text-muted)]">
                    {agentOnline ? "Loading LSI data…" : "Agent offline"}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
