"use client";

import React, { useEffect, useMemo, useState } from "react";
import LineChart from "./LineChart";
import type { DashboardService } from "@/lib/monitoring-types";

type TrendView = "overview" | "cpu" | "memory" | "request" | "network";

type ServiceSnapshot = {
  id: string;
  name: string;
  cpuCores: number;
  memoryMiB: number;
  requestRate: number;
};

type TrendSnapshot = {
  at: string;
  services: ServiceSnapshot[];
};

function ContainerHealth({ services }: { services: DashboardService[] }) {
  const [activeView, setActiveView] = useState<TrendView>("overview");
  const [selectedServiceId, setSelectedServiceId] = useState<string>("all");
  const [history, setHistory] = useState<TrendSnapshot[]>([]);

  useEffect(() => {
    if (services.length === 0) return;

    setHistory((prev) => {
      const last = prev[prev.length - 1];
      const unchanged =
        last &&
        last.services.length === services.length &&
        services.every((s, i) => {
          const snap = last.services[i];
          return (
            snap &&
            snap.id === s.id &&
            snap.cpuCores === s.cpuCores &&
            snap.memoryMiB === s.memoryMiB &&
            snap.requestRate === s.requestRate
          );
        });
      if (unchanged) return prev;

      const snapshot: TrendSnapshot = {
        at: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        services: services.map((service) => ({
          id: service.id,
          name: service.name,
          cpuCores: service.cpuCores,
          memoryMiB: service.memoryMiB,
          requestRate: service.requestRate,
        })),
      };

      return [...prev, snapshot].slice(-20);
    });
  }, [services]);

  const serviceOptions = useMemo(() => {
    const unique = new Map<string, string>();

    for (const service of services) {
      if (!unique.has(service.id)) {
        unique.set(service.id, service.name);
      }
    }

    return Array.from(unique.entries()).map(([id, name]) => ({ id, name }));
  }, [services]);

  useEffect(() => {
    if (selectedServiceId !== "all" && !serviceOptions.some((service) => service.id === selectedServiceId)) {
      setSelectedServiceId("all");
    }
  }, [serviceOptions]);

  const trendPoints = useMemo(() => {
    return history.map((snapshot) => {
      const selectedService = snapshot.services.find((service) => service.id === selectedServiceId);

      const totalCpu = snapshot.services.reduce((sum, service) => sum + service.cpuCores, 0);
      const totalMemory = snapshot.services.reduce((sum, service) => sum + service.memoryMiB, 0);
      const totalRequest = snapshot.services.reduce((sum, service) => sum + service.requestRate, 0);

      const cpu = selectedServiceId === "all" ? totalCpu : selectedService?.cpuCores ?? 0;
      const memory = selectedServiceId === "all" ? totalMemory : selectedService?.memoryMiB ?? 0;
      const request = selectedServiceId === "all" ? totalRequest : selectedService?.requestRate ?? 0;

      return {
        at: snapshot.at,
        cpu,
        memory,
        request,
        network: request,
      };
    });
  }, [history, selectedServiceId]);

  const chartConfig = useMemo(() => {
    const labels = trendPoints.map((point) => point.at);

    if (activeView === "overview") {
      return {
        labels,
        yAxisLabel: "Utilization",
        datasets: [
          {
            label: "CPU",
            data: trendPoints.map((point) => Number(point.cpu.toFixed(3))),
            borderColor: "#7CFC00",
          },
          {
            label: "Memory",
            data: trendPoints.map((point) => Number(point.memory.toFixed(1))),
            borderColor: "#38BDF8",
          },
          {
            label: "Request",
            data: trendPoints.map((point) => Number(point.request.toFixed(2))),
            borderColor: "#A855F7",
          },
          {
            label: "Network",
            data: trendPoints.map((point) => Number(point.network.toFixed(2))),
            borderColor: "#2563EB",
          },
        ],
      };
    }

    const mapByView: Record<Exclude<TrendView, "overview">, { label: string; key: "cpu" | "memory" | "request" | "network"; color: string; yAxisLabel: string }> = {
      cpu: { label: "CPU", key: "cpu", color: "#7CFC00", yAxisLabel: "CPU Cores" },
      memory: { label: "Memory", key: "memory", color: "#38BDF8", yAxisLabel: "Memory MiB" },
      request: { label: "Request", key: "request", color: "#A855F7", yAxisLabel: "Req/s" },
      network: { label: "Network", key: "network", color: "#2563EB", yAxisLabel: "Network Trend" },
    };

    const selected = mapByView[activeView];

    return {
      labels,
      yAxisLabel: selected.yAxisLabel,
      datasets: [
        {
          label: selected.label,
          data: trendPoints.map((point) => Number(point[selected.key].toFixed(2))),
          borderColor: selected.color,
        },
      ],
    };
  }, [activeView, trendPoints]);

  const totalCpu = services.reduce((sum, service) => sum + service.cpuCores, 0);
  const totalMemory = services.reduce((sum, service) => sum + service.memoryMiB, 0);
  const totalRate = services.reduce((sum, service) => sum + service.requestRate, 0);
  const running = services.filter((service) => service.status === "running").length;

  const tabs: Array<{ id: TrendView; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "cpu", label: "CPU" },
    { id: "memory", label: "Memory" },
    { id: "request", label: "Request" },
    { id: "network", label: "Network" },
  ];

  return (
    <div className="col-span-2 p-6 border border-[#5D5A5A] rounded-2xl h-full flex flex-col overflow-hidden bg-[#121B2B]">
      <div className="flex items-start justify-between gap-4 flex-shrink-0">
        <h1 className="font-bold text-5xl text-white leading-none">Container Health</h1>

        <select
          className="w-56 rounded-full border border-[#5D5A5A] bg-[#26344F] px-4 py-2 text-sm text-gray-100 focus:outline-none"
          value={selectedServiceId}
          onChange={(event) => setSelectedServiceId(event.target.value)}
        >
          <option value="all">All Services</option>
          {serviceOptions.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveView(tab.id)}
            className={`min-w-28 rounded-xl border px-4 py-2 text-sm transition ${
              activeView === tab.id
                ? "border-[#8CA3C8] bg-[#26344F] text-white"
                : "border-[#5D5A5A] bg-transparent text-gray-200 hover:border-[#8CA3C8]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex-1 min-h-0 border border-[#5D5A5A] rounded-xl p-4">
        <LineChart
          labels={chartConfig.labels}
          datasets={chartConfig.datasets}
          yAxisLabel={chartConfig.yAxisLabel}
        />
      </div>

      <div className="mt-2 flex items-center justify-center gap-6 text-xs text-gray-200 flex-shrink-0">
        {chartConfig.datasets.map((dataset) => (
          <div key={dataset.label} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: dataset.borderColor }}
            />
            <span>{dataset.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-white flex-shrink-0">
        <div className="border border-[#5D5A5A] rounded-md p-2 text-center bg-[#0f172a]">
          CPU {totalCpu.toFixed(3)}
        </div>
        <div className="border border-[#5D5A5A] rounded-md p-2 text-center bg-[#0f172a]">
          MEM {totalMemory.toFixed(1)} MiB
        </div>
        <div className="border border-[#5D5A5A] rounded-md p-2 text-center bg-[#0f172a]">
          REQ {totalRate.toFixed(2)}
        </div>
        <div className="border border-[#5D5A5A] rounded-md p-2 text-center bg-[#0f172a]">
          UP {running}/{services.length}
        </div>
      </div>
    </div>
  );
}

export default ContainerHealth;
