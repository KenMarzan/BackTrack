"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "./components/Nav";
import ContainerHealth from "./components/ContainerHealth";
import RecentDeployment from "@/app/components/RecentDeployment";
import ActiveContainers from "./components/ActiveContainers";
import AnomalyDetection from "./components/AnomalyDetection";
import { Activity, Plug, RefreshCw, Server } from "lucide-react";
import Link from "next/link";
import type { DashboardService, DashboardAnomaly } from "@/lib/monitoring-types";
import type { RollbackEvent } from "@/app/components/RollbackEventCard";
import RollbackToastStack, { type RollbackToast } from "@/app/components/RollbackToast";

export default function Home() {
  const [services, setServices] = useState<DashboardService[]>([]);
  const [anomalies, setAnomalies] = useState<DashboardAnomaly[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "error">("idle");
  const [rollbackEvents, setRollbackEvents] = useState<RollbackEvent[]>([]);
  const [rollbackToasts, setRollbackToasts] = useState<RollbackToast[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setSyncState("syncing");
      try {
        const response = await fetch("/api/dashboard/overview", { cache: "no-store" });
        const data = await response.json();

        if (!active) return;
        setServices(data.services ?? []);
        setAnomalies(data.anomalies ?? []);
        setLastSync(new Date());
        setSyncState("idle");
      } catch {
        if (!active) return;
        setServices([]);
        setAnomalies([]);
        setSyncState("error");
      }
    };

    load();
    const timer = window.setInterval(load, 10000);

    const refresh = () => {
      load();
    };

    window.addEventListener("backtrack:connection-updated", refresh);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("backtrack:connection-updated", refresh);
    };
  }, []);

  const lastSyncLabel = useMemo(() => {
    if (!lastSync) return "—";
    return lastSync.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [lastSync]);

  const handleAnomalyRollback = (anomaly: DashboardAnomaly) => {
    const evId = Date.now();
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
              id: Date.now(),
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

  const handleDismissRollback = (id: number) => {
    setRollbackEvents((prev) => prev.filter((e) => e.id !== id));
  };

  const handleDismissToast = (id: number) => {
    setRollbackToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const healthSummary = useMemo(() => {
    const total = services.length;
    const up = services.filter((s) => s.status === "running").length;
    const down = services.filter((s) => s.status === "down").length;
    return { total, up, down };
  }, [services]);

  return (
    <div className="h-screen overflow-hidden w-full flex flex-col bg-transparent">
      <RollbackToastStack toasts={rollbackToasts} onDismiss={handleDismissToast} />
      <Nav healthSummary={healthSummary} />

      <main className="flex-1 min-h-0 w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-4 lg:py-5 flex flex-col gap-3 lg:gap-4 overflow-hidden">
        {/* Status strip */}
        <section className="bt-rise flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ animationDelay: "0ms" }}>
          <div className="flex items-center gap-3">
            <Link href="/anomalies" className="inline-flex items-center gap-2 rounded-full border border-[rgba(148,163,184,0.15)] bg-white/[0.02] px-3 py-1.5 hover:border-[rgba(94,234,212,0.35)] hover:bg-[rgba(94,234,212,0.06)] transition group">
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
            <div className="bt-shimmer flex items-center gap-2 rounded-full border border-[rgba(148,163,184,0.15)] bg-white/[0.02] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
              <RefreshCw
                size={13}
                className={`text-[var(--accent-teal)] ${syncState === "syncing" ? "animate-spin" : ""}`}
              />
              <span className="bt-mono text-[11px]">
                {syncState === "error" ? "sync failed" : `synced ${lastSyncLabel}`}
              </span>
              <span className="h-3 w-px bg-[var(--border-mid)]" />
              <span className="bt-mono text-[11px] text-[var(--text-muted)]">10s</span>
            </div>
          </div>
        </section>

        {/* Empty state — compact banner */}
        {services.length === 0 && syncState !== "syncing" && lastSync !== null && (
          <section className="bt-rise flex-shrink-0">
            <div className="rounded-xl border border-[rgba(94,234,212,0.18)] bg-[rgba(94,234,212,0.04)] px-4 py-3 flex items-center gap-3">
              <Server size={15} className="text-[var(--accent-teal)] flex-shrink-0" />
              <span className="text-[13px] text-[var(--text-secondary)] flex-1">
                No clusters connected — connect a Kubernetes cluster or Docker daemon to start monitoring.
              </span>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("backtrack:open-configure"))}
                className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(94,234,212,0.45)] bg-[rgba(94,234,212,0.10)] px-3 py-1.5 text-[12px] text-[#c6f5e8] hover:bg-[rgba(94,234,212,0.18)] transition flex-shrink-0"
              >
                <Plug size={12} className="text-[var(--accent-teal)]" />
                Configure
              </button>
            </div>
          </section>
        )}

        {/* Loading state */}
        {syncState === "syncing" && lastSync === null && (
          <section className="bt-rise flex-shrink-0">
            <div className="rounded-xl border border-[var(--border-soft)] bg-white/[0.02] px-4 py-3 flex items-center gap-3">
              <RefreshCw size={13} className="text-[var(--accent-teal)] animate-spin flex-shrink-0" />
              <span className="text-[13px] text-[var(--text-muted)]">Connecting to cluster…</span>
            </div>
          </section>
        )}

        {/* Primary grid: health + deployments */}
        <section className="bt-rise flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-3 gap-3 lg:gap-4" style={{ animationDelay: "80ms" }}>
          <div className="xl:col-span-2 min-h-0 h-full">
            <ContainerHealth services={services} />
          </div>
          <div className="xl:col-span-1 min-h-0 h-full">
            <RecentDeployment
              rollbackEvents={rollbackEvents}
              onDismissRollback={handleDismissRollback}
            />
          </div>
        </section>

        {/* Secondary grid: anomalies + containers */}
        <section className="bt-rise h-[380px] grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4" style={{ animationDelay: "160ms" }}>
          <div className="min-h-0 h-full">
            <AnomalyDetection anomalies={anomalies} onAnomalyRollback={handleAnomalyRollback} />
          </div>
          <div className="min-h-0 h-full">
            <ActiveContainers services={services} />
          </div>
        </section>

        <footer className="pt-2 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            <span className="bt-mono uppercase tracking-[0.2em]">backtrack</span>
            <span>/</span>
            <span>local-first observability</span>
          </div>
          <div className="flex items-center gap-3 bt-mono">
            <span>services {healthSummary.up}/{healthSummary.total}</span>
            <span className="h-3 w-px bg-[var(--border-mid)]" />
            <span>anomalies {anomalies.length}</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
