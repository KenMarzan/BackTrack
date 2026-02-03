"use client";

import { useState, useEffect } from "react";
import LineChart from "./LineChart";

type MetricType = "overall" | "cpu" | "memory" | "network" | "disk" | "latency";

interface MetricData {
  title: string;
  data: { time: string; value: number }[];
  color: string;
  current: string;
  average: string;
  peak: string;
}

interface MetricsResponse {
  current: {
    cpu: string;
    memory: string;
    network: string;
    disk: string;
  };
  timeSeries: {
    cpu: { timestamp: number; value: number }[];
    memory: { timestamp: number; value: number }[];
    network: { timestamp: number; value: number }[];
    disk: { timestamp: number; value: number }[];
    requestRate: { timestamp: number; value: number }[];
  };
  labels: string[];
}

function ContainerHealth() {
  const [selectedMetric, setSelectedMetric] = useState<MetricType>("overall");
  const [metricsData, setMetricsData] = useState<MetricsResponse | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await fetch("/api/metrics");
        const data = await response.json();
        setMetricsData(data);
      } catch (error) {
        console.error("Failed to fetch metrics:", error);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 15000);
    return () => clearInterval(interval);
  }, []);

  const formatTimeSeriesForChart = (
    timeSeries: { timestamp: number; value: number }[],
  ) => {
    return timeSeries.map((point, index) => ({
      time: metricsData?.labels[index] || "",
      value: Math.round(point.value * 10) / 10,
    }));
  };

  const calculateStats = (values: number[]) => {
    if (values.length === 0) return { current: "0", average: "0", peak: "0" };
    const current = values[values.length - 1];
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    const peak = Math.max(...values);
    return {
      current: current.toFixed(1),
      average: average.toFixed(1),
      peak: peak.toFixed(1),
    };
  };

  const getMetricConfig = (): MetricData => {
    if (!metricsData) {
      return {
        title: "CPU Usage",
        data: [],
        color: "#3B82F6",
        current: "0",
        average: "0",
        peak: "0",
      };
    }

    const metricsConfig: Record<MetricType, MetricData> = {
      overall: {
        title: "Overall Metrics",
        data: formatTimeSeriesForChart(metricsData.timeSeries.cpu),
        color: "#6B7280",
        current: "-",
        average: "-",
        peak: "-",
      },
      cpu: {
        title: "CPU Usage",
        data: formatTimeSeriesForChart(metricsData.timeSeries.cpu),
        color: "#3B82F6",
        ...calculateStats(metricsData.timeSeries.cpu.map((d) => d.value)),
      },
      memory: {
        title: "Memory Usage",
        data: formatTimeSeriesForChart(metricsData.timeSeries.memory),
        color: "#10B981",
        ...calculateStats(metricsData.timeSeries.memory.map((d) => d.value)),
      },
      network: {
        title: "Network I/O",
        data: formatTimeSeriesForChart(metricsData.timeSeries.network),
        color: "#F59E0B",
        ...calculateStats(metricsData.timeSeries.network.map((d) => d.value)),
      },
      disk: {
        title: "Disk I/O",
        data: formatTimeSeriesForChart(metricsData.timeSeries.disk),
        color: "#EF4444",
        ...calculateStats(metricsData.timeSeries.disk.map((d) => d.value)),
      },
      latency: {
        title: "Request Latency",
        data: formatTimeSeriesForChart(metricsData.timeSeries.requestRate),
        color: "#8B5CF6",
        ...calculateStats(
          metricsData.timeSeries.requestRate.map((d) => d.value),
        ),
      },
    };

    return metricsConfig[selectedMetric];
  };

  const currentMetric = getMetricConfig();
  const suffix =
    selectedMetric === "network" ||
    selectedMetric === "disk" ||
    selectedMetric === "latency"
      ? selectedMetric === "latency"
        ? "ms"
        : "MB/s"
      : "%";

  return (
    <div className="col-span-2 p-6 border border-[#5D5A5A] rounded-2xl h-full flex flex-col overflow-hidden">
      <h1 className="font-bold text-2xl text-white flex-shrink-0">
        Container Health
      </h1>

      <div className="flex flex-row gap-2 mt-1 flex-shrink-0">
        <button
          onClick={() => setSelectedMetric("overall")}
          className={`w-30 border rounded-xl p-1 text-center flex flex-row justify-center gap-1 transition-colors ${
            selectedMetric === "overall"
              ? "bg-gray-500 border-gray-500 text-white"
              : "border-white text-white hover:bg-white/10"
          }`}
        >
          <p className="text-md">Overall</p>
        </button>
        <button
          onClick={() => setSelectedMetric("cpu")}
          className={`w-30 border rounded-xl p-1 text-center flex flex-row justify-center gap-1 transition-colors ${
            selectedMetric === "cpu"
              ? "bg-blue-500 border-blue-500 text-white"
              : "border-white text-white hover:bg-white/10"
          }`}
        >
          <p className="text-md">CPU</p>
        </button>
        <button
          onClick={() => setSelectedMetric("memory")}
          className={`w-30 border rounded-xl p-1 text-center flex flex-row justify-center gap-1 transition-colors ${
            selectedMetric === "memory"
              ? "bg-green-500 border-green-500 text-white"
              : "border-white text-white hover:bg-white/10"
          }`}
        >
          <p className="text-md">Memory</p>
        </button>
        <button
          onClick={() => setSelectedMetric("network")}
          className={`w-30 border rounded-xl p-1 text-center flex flex-row justify-center gap-1 transition-colors ${
            selectedMetric === "network"
              ? "bg-orange-500 border-orange-500 text-white"
              : "border-white text-white hover:bg-white/10"
          }`}
        >
          <p className="text-md">Network</p>
        </button>
        <button
          onClick={() => setSelectedMetric("disk")}
          className={`w-30 border rounded-xl p-1 text-center flex flex-row justify-center gap-1 transition-colors ${
            selectedMetric === "disk"
              ? "bg-red-500 border-red-500 text-white"
              : "border-white text-white hover:bg-white/10"
          }`}
        >
          <p className="text-md">Disk</p>
        </button>
        <button
          onClick={() => setSelectedMetric("latency")}
          className={`w-30 border rounded-xl p-1 text-center flex flex-row justify-center gap-1 transition-colors ${
            selectedMetric === "latency"
              ? "bg-purple-500 border-purple-500 text-white"
              : "border-white text-white hover:bg-white/10"
          }`}
        >
          <p className="text-md">Latency</p>
        </button>
      </div>

      <div className="mt-4 flex-1 min-h-0 flex flex-col">
        <h2 className="text-white text-sm mb-2">{currentMetric.title}</h2>
        <div className="flex-1 min-h-0">
          <LineChart
            data={currentMetric.data}
            color={currentMetric.color}
            selectedMetric={selectedMetric}
            metricsData={metricsData || undefined}
          />
        </div>
      </div>

      {selectedMetric !== "overall" && (
        <div className="mt-4 flex flex-row gap-6 flex-shrink-0">
          <div className="flex flex-col border border-[#5D5A5A] rounded-xl p-3 flex-1">
            <p className="text-gray-400 text-xs">Current</p>
            <p className="text-white text-xl font-semibold">
              {currentMetric.current}
              {suffix}
            </p>
          </div>
          <div className="flex flex-col border border-[#5D5A5A] rounded-xl p-3 flex-1">
            <p className="text-gray-400 text-xs">Average</p>
            <p className="text-white text-xl font-semibold">
              {currentMetric.average}
              {suffix}
            </p>
          </div>
          <div className="flex flex-col border border-[#5D5A5A] rounded-xl p-3 flex-1">
            <p className="text-gray-400 text-xs">Peak</p>
            <p className="text-white text-xl font-semibold">
              {currentMetric.peak}
              {suffix}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default ContainerHealth;
