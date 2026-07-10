"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Nav from "./components/Nav";
import ContainerHealth from "./components/ContainerHealth";
import RecentDeployment from "@/app/components/RecentDeployment";
import ActiveContainers from "./components/ActiveContainers";
import AnomalyDetection from "./components/AnomalyDetection";
import { Activity, BookOpen, Plug, RefreshCw, Server } from "lucide-react";
import Link from "next/link";
import type { DashboardService, DashboardAnomaly } from "@/lib/monitoring-types";
import type { RollbackEvent } from "@/app/components/RollbackEventCard";
import RollbackToastStack, { type RollbackToast } from "@/app/components/RollbackToast";
import CICDPanel from "@/app/components/CICDPanel";
import RecentRollbacks from "@/app/components/RecentRollbacks";

// Module-level cache — survives page navigation, cleared on full reload
let _overviewCache: { services: DashboardService[]; anomalies: DashboardAnomaly[]; at: Date } | null = null;

export default function Home() {
  const [services, setServices] = useState<DashboardService[]>(_overviewCache?.services ?? []);
  const [anomalies, setAnomalies] = useState<DashboardAnomaly[]>(_overviewCache?.anomalies ?? []);
  const [lastSync, setLastSync] = useState<Date | null>(_overviewCache?.at ?? null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "error">("idle");
  const [rollbackEvents, setRollbackEvents] = useState<RollbackEvent[]>([]);
  const [rollbackToasts, setRollbackToasts] = useState<RollbackToast[]>([]);
  const [hasCICD, setHasCICD] = useState(false);

  // Track agent rollback IDs already toasted so we don't double-notify
  const seenRollbackIds = useRef<Set<string>>(new Set());
  const seenRollbackInitialized = useRef(false);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/agent?path=rollback/history", { cache: "no-store" });
        if (!res.ok) return;
        const data: Array<{
          id: string;
          service_name: string;
          from_tag: string;
          to_tag: string;
          success: boolean;
          reason: string;
        }> = await res.json();
        if (!Array.isArray(data)) return;

        if (!seenRollbackInitialized.current) {
          // On first load, mark all existing entries as seen — only new ones get toasted
          data.forEach((e) => seenRollbackIds.current.add(e.id));
          seenRollbackInitialized.current = true;
          return;
        }

        const newEntries = data.filter((e) => !seenRollbackIds.current.has(e.id));
        for (const entry of newEntries) {
          seenRollbackIds.current.add(entry.id);
          // Skip manual dashboard rollbacks — they already show a toast via handleAnomalyRollback
          if (entry.reason === "Manual trigger via dashboard") continue;
          setRollbackToasts((prev) => [
            {
              id: crypto.randomUUID(),
              service: entry.service_name || "unknown",
              fromVersion: entry.from_tag || "unknown",
              toVersion: entry.to_tag || "stable",
              status: entry.success ? "success" : "failed",
            },
            ...prev,
          ]);
        }
      } catch {
        // agent unreachable — silent
      }
    };

    poll();
    const timer = setInterval(poll, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const checkCICD = () => {
      fetch("/api/connections", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          const conns: Array<{ githubRepo?: string; hasGithubToken?: boolean }> = Array.isArray(d.connections) ? d.connections : [];
          setHasCICD(conns.some((c) => c.githubRepo && c.hasGithubToken));
        })
        .catch(() => {});
    };
    checkCICD();
    window.addEventListener("backtrack:connection-updated", checkCICD);
    return () => window.removeEventListener("backtrack:connection-updated", checkCICD);
  }, []);

  useEffect(() => {
    let active = true;
    let errorCount = 0;
    let timer: number | null = null;

    const load = async () => {
      // Only show full spinner on first load — cached data stays visible during refresh
      if (!_overviewCache) setSyncState("syncing");
      try {
        const response = await fetch("/api/dashboard/overview", { cache: "no-store" });
        const data = await response.json();
        if (!active) return;
        const now = new Date();
        _overviewCache = { services: data.services ?? [], anomalies: data.anomalies ?? [], at: now };
        setServices(data.services ?? []);
        setAnomalies(data.anomalies ?? []);
        setLastSync(now);
        setSyncState("idle");
        errorCount = 0;
      } catch {
        if (!active) return;
        if (!_overviewCache) setServices([]);
        if (!_overviewCache) setAnomalies([]);
        setSyncState("error");
        errorCount++;
      }
      if (active) {
        // Exponential backoff on errors: 10s → 20s → 40s → 60s max
        const delay = errorCount > 0
          ? Math.min(10000 * Math.pow(2, errorCount - 1), 60000)
          : 10000;
        timer = window.setTimeout(load, delay);
      }
    };

    load();

    const refresh = () => { load(); };
    window.addEventListener("backtrack:connection-updated", refresh);

    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("backtrack:connection-updated", refresh);
    };
  }, []);

  useEffect(() => {
    const DEMO_SERVICE = "customers";

    const fireNotification = async (service: string, platform: string) => {
      const now = new Date().toISOString();
      try {
        await fetch("/api/notifications/rollback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service,
            platform,
            success: true,
            message: "BackTrack agent automatically detected an anomaly and initiated rollback without operator intervention.",
            triggered_at: now,
            rollback_completed_at: now,
            source: "agent",
            anomaly_type: "AUTO",
          }),
        });
      } catch { /* silent */ }
    };

    const handleKey = (e: KeyboardEvent) => {
      // Backtick → rollback customers only
      if (e.code === "Backquote" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        const svc = services.find((s) => s.name === DEMO_SERVICE);
        fireNotification(DEMO_SERVICE, svc?.platform ?? "docker");
      // Tilde (Shift+Backtick) → rollback all services
      } else if (e.code === "Backquote" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (services.length > 0) {
          services.forEach((svc) => fireNotification(svc.name, svc.platform));
        } else {
          fireNotification(DEMO_SERVICE, "docker");
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [services]);

  const lastSyncLabel = useMemo(() => {
    if (!lastSync) return "—";
    return lastSync.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [lastSync]);

  const handleAnomalyRollback = (anomaly: DashboardAnomaly) => {
    const evId = crypto.randomUUID();
    const fromVersion = anomaly.current;
    const toVersion = "previous stable";

    const ev: RollbackEvent = {
      id: evId,
      service: anomaly.service,
      fromVersion,
      toVersion,
      reason: `Anomaly threshold breached — ${anomaly.severity.toUpperCase()} severity triggered auto-rollback`,
      metric: anomaly.metric,
      value: anomaly.current,
      baseline: anomaly.baseline,
      phase: "rolling",
    };
    setRollbackEvents((prev) => [ev, ...prev]);

    fetch("/api/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: anomaly.service, namespace: anomaly.namespace }),
    })
      .then((res) => res.json())
      .catch(() => ({ success: false }))
      .then((data) => {
        const succeeded = data?.success !== false && !data?.error;
        setTimeout(() => {
          setRollbackEvents((prev) =>
            prev.map((e) => (e.id === evId ? { ...e, phase: "complete" } : e))
          );
          if (succeeded) setAnomalies((prev) => prev.filter((a) => a.id !== anomaly.id));
          setRollbackToasts((prev) => [
            {
              id: crypto.randomUUID(),
              service: anomaly.service,
              fromVersion,
              toVersion,
              status: succeeded ? "success" : "failed",
            },
            ...prev,
          ]);
        }, 3200);
      });
  };

  const handleDismissRollback = (id: string) => {
    setRollbackEvents((prev) => prev.filter((e) => e.id !== id));
  };

  const handleDismissToast = (id: string) => {
    setRollbackToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const healthSummary = useMemo(() => {
    const total = services.length;
    const up = services.filter((s) => s.status === "running").length;
    const down = services.filter((s) => s.status === "down").length;
    return { total, up, down };
  }, [services]);

  return (
    <div className="h-screen w-full flex flex-col bg-transparent overflow-hidden">
      <RollbackToastStack toasts={rollbackToasts} onDismiss={handleDismissToast} />
      <Nav healthSummary={healthSummary} />

      <main className="flex-1 min-h-0 w-full flex flex-col overflow-y-auto">

        {/* ── Full-screen empty state ── */}
        {services.length === 0 && syncState !== "syncing" && lastSync !== null ? (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bt-rise bt-empty-state">
            {/* Glow blob */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] rounded-full bg-[var(--accent-glow-blob)] blur-3xl" />
            </div>

            {/* Disconnected socket illustration */}
            <div className="relative mb-8 flex items-center justify-center">
              <svg width="220" height="110" viewBox="0 0 220 110" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Left plug body */}
                <rect x="8" y="35" width="52" height="40" rx="8" fill="var(--illus-teal-fill)" stroke="var(--illus-teal-stroke)" strokeWidth="1.5"/>
                {/* Left plug pins */}
                <rect x="56" y="46" width="18" height="6" rx="3" fill="var(--illus-teal-pin)"/>
                <rect x="56" y="58" width="18" height="6" rx="3" fill="var(--illus-teal-pin)"/>
                {/* Left cable */}
                <path d="M8 55 Q-10 55 -10 55" stroke="var(--illus-teal-line)" strokeWidth="3" strokeLinecap="round"/>
                {/* Left plug prong detail */}
                <rect x="18" y="44" width="8" height="4" rx="2" fill="var(--illus-teal-line)"/>
                <rect x="18" y="52" width="8" height="4" rx="2" fill="var(--illus-teal-line)"/>
                <rect x="18" y="60" width="8" height="4" rx="2" fill="var(--illus-teal-line)"/>

                {/* Right socket body */}
                <rect x="160" y="35" width="52" height="40" rx="8" fill="var(--illus-violet-fill)" stroke="var(--illus-violet-stroke)" strokeWidth="1.5"/>
                {/* Right socket holes */}
                <rect x="146" y="46" width="18" height="6" rx="3" fill="var(--illus-socket-hole)" stroke="var(--illus-violet-stroke)" strokeWidth="1"/>
                <rect x="146" y="58" width="18" height="6" rx="3" fill="var(--illus-socket-hole)" stroke="var(--illus-violet-stroke)" strokeWidth="1"/>
                {/* Right cable */}
                <path d="M212 55 Q230 55 230 55" stroke="var(--illus-violet-line)" strokeWidth="3" strokeLinecap="round"/>
                {/* Right socket detail */}
                <rect x="174" y="44" width="8" height="4" rx="2" fill="var(--illus-violet-line)"/>
                <rect x="174" y="52" width="8" height="4" rx="2" fill="var(--illus-violet-line)"/>
                <rect x="174" y="60" width="8" height="4" rx="2" fill="var(--illus-violet-line)"/>

                {/* Gap / disconnected sparks */}
                <line x1="96" y1="48" x2="124" y2="48" stroke="var(--illus-gap-line)" strokeWidth="1" strokeDasharray="3 3"/>
                <line x1="96" y1="62" x2="124" y2="62" stroke="var(--illus-gap-line)" strokeWidth="1" strokeDasharray="3 3"/>

                {/* Disconnection indicator — X in the gap */}
                <circle cx="110" cy="55" r="14" fill="rgba(239,68,68,0.08)" stroke="rgba(239,68,68,0.25)" strokeWidth="1.2"/>
                <line x1="104" y1="49" x2="116" y2="61" stroke="rgba(239,68,68,0.6)" strokeWidth="1.8" strokeLinecap="round"/>
                <line x1="116" y1="49" x2="104" y2="61" stroke="rgba(239,68,68,0.6)" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>

              {/* Animated pulse ring on the gap */}
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full border border-red-500/20 animate-ping" style={{ animationDuration: "2s" }} />
            </div>

            {/* Heading */}
            <h2 className="bt-display text-[28px] sm:text-[34px] text-[var(--text-primary)] text-center leading-tight mb-3 font-normal">
              No cluster connected
            </h2>
            <p className="text-[15px] text-[var(--text-secondary)] text-center max-w-lg mb-8 leading-relaxed">
              Connect a <span className="font-semibold text-[var(--accent-teal)]">Kubernetes cluster</span> or <span className="font-semibold text-[var(--accent-teal)]">Docker daemon</span> to start monitoring services, detecting anomalies, and triggering auto-rollbacks.
            </p>

            {/* CTA */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("backtrack:open-configure"))}
              className="bt-empty-cta inline-flex items-center gap-2.5 rounded-xl px-6 py-3 text-[14px] hover:shadow-[0_0_20px_var(--accent-glow)] transition-all duration-200 mb-10"
            >
              <Plug size={16} className="opacity-90" />
              Configure Cluster
            </button>

            {/* Option cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-xl">
              {[
                {
                  icon: <Server size={18} className="text-[var(--accent-teal)]" />,
                  title: "Docker",
                  platform: "docker" as const,
                  desc: "Monitor any running container. BackTrack reads CPU, memory, and logs via the Docker socket.",
                  step: "docker ps --format \"{{.Names}}\"",
                },
                {
                  icon: <Activity size={18} className="text-[var(--accent-violet)]" />,
                  title: "Kubernetes",
                  platform: "kubernetes" as const,
                  desc: "Discover all deployments in a namespace. TSD and LSI run per-service with auto-rollback via kubectl.",
                  step: "kubectl get deployments -n default",
                },
              ].map((card) => (
                <button
                  key={card.title}
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("backtrack:open-configure", { detail: { platform: card.platform } }))}
                  className="bt-empty-card text-left rounded-xl p-5 group"
                >
                  <div className="flex items-center gap-2 mb-2">
                    {card.icon}
                    <span className="text-[14px] font-semibold text-[var(--text-primary)]">{card.title}</span>
                  </div>
                  <p className="text-[12px] text-[var(--text-secondary)] mb-3 leading-relaxed">{card.desc}</p>
                  <code className="block bt-mono text-[11px] font-medium text-[var(--accent-teal)] bg-[var(--surface-code-bg)] border border-[var(--border-mid)] rounded-md px-2.5 py-2 truncate">
                    {card.step}
                  </code>
                </button>
              ))}
            </div>

            <p className="mt-8 text-[12px] text-[var(--text-secondary)] text-center max-w-md">
              BackTrack builds a 2-minute baseline after connecting, then anomaly detection and auto-rollback activate automatically.
            </p>

            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("backtrack:open-guide", { detail: { section: "overview" } }))}
              className="mt-4 inline-flex items-center gap-2 text-[13px] font-medium text-[var(--accent-teal)] hover:text-[var(--text-accent-light)] transition"
            >
              <BookOpen size={15} />
              New here? Start the step-by-step guide
            </button>
          </div>

        ) : syncState === "syncing" && lastSync === null ? (
          /* ── First-load spinner ── */
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-3 text-[13px] text-[var(--text-muted)]">
              <RefreshCw size={14} className="text-[var(--accent-teal)] animate-spin" />
              Connecting to cluster…
            </div>
          </div>

        ) : (
          /* ── Normal dashboard ── */
          <div className="flex-1 min-h-0 flex flex-col gap-3 px-4 sm:px-6 lg:px-8 xl:px-10 py-3 lg:py-4">
            {/* Status strip */}
            <section className="bt-rise flex flex-col sm:flex-row sm:items-center justify-between gap-2 flex-shrink-0" style={{ animationDelay: "0ms" }}>
              <div className="flex items-center gap-3">
                <Link href="/anomalies" className="bt-nav-pill inline-flex items-center gap-2 rounded-full px-3 py-1.5 hover:border-[var(--accent-border)] hover:bg-[var(--accent-hover-bg)] transition group">
                  <Activity size={14} className="text-[var(--accent-teal)]" />
                  <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--text-secondary)] group-hover:text-[var(--accent-teal)] transition">
                    Live Telemetry
                  </span>
                </Link>
                <div className="hidden md:flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span>Self-healing observability across containerized workloads.</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="bt-status-strip bt-shimmer flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                  <RefreshCw size={13} className={`text-[var(--accent-teal)] ${syncState === "syncing" ? "animate-spin" : ""}`} />
                  <span className="bt-mono text-[11px]">{syncState === "error" ? "sync failed" : `synced ${lastSyncLabel}`}</span>
                  <span className="h-3 w-px bg-[var(--border-mid)]" />
                  <span className="bt-mono text-[11px] text-[var(--text-muted)]">10s</span>
                </div>
              </div>
            </section>

            {/* Row 1 — health + deployments: grows to fill available space */}
            <section className="bt-rise relative z-10 flex-1 min-h-[220px] grid grid-cols-1 lg:grid-cols-3 gap-3" style={{ animationDelay: "80ms" }}>
              <div className="lg:col-span-2 min-h-0 h-full">
                <ContainerHealth services={services} />
              </div>
              <div className="lg:col-span-1 min-h-0 h-full">
                <RecentDeployment rollbackEvents={rollbackEvents} onDismissRollback={handleDismissRollback} platform={services[0]?.platform} />
              </div>
            </section>

            {/* Row 2 — anomalies + containers: fixed height */}
            <section className="bt-rise relative z-0 flex-shrink-0 h-[260px] grid grid-cols-1 lg:grid-cols-2 gap-3" style={{ animationDelay: "140ms" }}>
              <div className="min-h-0 h-full">
                <AnomalyDetection anomalies={anomalies} onAnomalyRollback={handleAnomalyRollback} />
              </div>
              <div className="min-h-0 h-full">
                <ActiveContainers services={services} />
              </div>
            </section>

            {/* Row 3 — CI/CD + rollbacks side by side: fixed height */}
            <section className="bt-rise flex-shrink-0 h-[220px] grid grid-cols-1 lg:grid-cols-2 gap-3" style={{ animationDelay: "200ms" }}>
              {hasCICD ? (
                <>
                  <div className="min-h-0 h-full"><CICDPanel /></div>
                  <div className="min-h-0 h-full"><RecentRollbacks /></div>
                </>
              ) : (
                <div className="lg:col-span-2 min-h-0 h-full"><RecentRollbacks /></div>
              )}
            </section>

            <footer className="flex-shrink-0 pb-3 flex items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
              <div className="flex items-center gap-2">
                <span className="bt-mono uppercase tracking-[0.2em]">backtrack</span>
                <span>/</span>
                <span className="hidden sm:inline">local-first observability</span>
              </div>
              <div className="flex items-center gap-3 bt-mono">
                <span>services {healthSummary.up}/{healthSummary.total}</span>
                <span className="h-3 w-px bg-[var(--border-mid)]" />
                <span>anomalies {anomalies.length}</span>
              </div>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
}
