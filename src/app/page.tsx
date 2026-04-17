"use client";

import { useEffect, useMemo, useState } from "react";
import Nav from "./components/Nav";
import ContainerHealth from "./components/ContainerHealth";
import RecentDeployment from "@/app/components/RecentDeployment";
import ActiveContainers from "./components/ActiveContainers";
import AnomalyDetection from "./components/AnomalyDetection";
import { Activity, RefreshCw } from "lucide-react";
import type { DashboardService, DashboardAnomaly } from "@/lib/monitoring-types";

export default function Home() {
  const [services, setServices] = useState<DashboardService[]>([]);
  const [anomalies, setAnomalies] = useState<DashboardAnomaly[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "error">("idle");

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

  const healthSummary = useMemo(() => {
    const total = services.length;
    const up = services.filter((s) => s.status === "running").length;
    const down = services.filter((s) => s.status === "down").length;
    return { total, up, down };
  }, [services]);

  return (
    <div className="min-h-screen w-full flex flex-col bg-transparent">
      <Nav healthSummary={healthSummary} />

      <main className="flex-1 w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6 lg:py-8 flex flex-col gap-5 lg:gap-6">
        {/* Status strip */}
        <section className="bt-rise flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(148,163,184,0.15)] bg-white/[0.02] px-3 py-1.5">
              <Activity size={14} className="text-[var(--accent-teal)]" />
              <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--text-secondary)]">
                Live Telemetry
              </span>
            </div>
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

        {/* Primary grid: health + deployments */}
        <section className="bt-rise grid grid-cols-1 xl:grid-cols-3 gap-5 lg:gap-6">
          <div className="xl:col-span-2 min-h-[460px]">
            <ContainerHealth services={services} />
          </div>
          <div className="xl:col-span-1 min-h-[460px]">
            <RecentDeployment />
          </div>
        </section>

        {/* Secondary grid: anomalies + containers */}
        <section className="bt-rise grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
          <div className="min-h-[360px]">
            <AnomalyDetection anomalies={anomalies} />
          </div>
          <div className="min-h-[360px]">
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
