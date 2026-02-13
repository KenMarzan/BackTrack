"use client";

import { useState, useEffect } from "react";
import LineChart from "./LineChart";
import {
  Cpu,
  MemoryStick,
  Network,
  HardDrive,
  Timer,
  LayoutGrid,
  Activity,
  BarChart3,
  TrendingUp,
} from "lucide-react";

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

interface ContainerData {
  key: string;
  namespace: string;
  pod: string;
  container: string;
  cpuCores: number;
  memoryBytes: number;
  networkRxBytesPerSec: number;
  networkTxBytesPerSec: number;
  diskReadBytesPerSec: number;
  diskWriteBytesPerSec: number;
  latencyP95Ms: number | null;
}

function ContainerHealth() {
  const [selectedMetric, setSelectedMetric] = useState<MetricType>("overall");
  const [metricsData, setMetricsData] = useState<MetricsResponse | null>(null);
  const [containers, setContainers] = useState<ContainerData[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

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

    const fetchContainers = async () => {
      try {
        const response = await fetch("/api/container-health");
        const data = await response.json();
        setContainers(data);
        if (data.length > 0 && !selectedContainer) {
          setSelectedContainer(data[0].key);
        }
      } catch (error) {
        console.error("Failed to fetch containers:", error);
      }
    };

    fetchMetrics();
    fetchContainers();
    const interval = setInterval(() => {
      fetchMetrics();
      fetchContainers();
    }, 15000);
    return () => clearInterval(interval);
  }, [selectedContainer]);

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
    <div className="col-span-2 p-6 border border-[#5D5A5A] rounded-2xl h-full w-[1350px] flex flex-col overflow-hidden">
      <div className="flex flex-row justify-between items-center flex-shrink-0">
        <h1 className="font-bold text-2xl text-white">Container Health</h1>

        {containers.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="bg-transparent text-white text-sm cursor-pointer pr-6 focus:outline-none border-none outline-none flex items-center"
            >
              {selectedContainer}
              <svg
                className={`ml-2 w-4 h-4 text-white transition-transform ${isDropdownOpen ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 bg-[#161C27] rounded-lg shadow-lg z-50 min-w-[200px] max-h-[300px] overflow-y-auto scrollbar-hide">
                {containers.map((container) => (
                  <div
                    key={container.key}
                    onClick={() => {
                      setSelectedContainer(container.key);
                      setIsDropdownOpen(false);
                    }}
                    className="text-white text-sm py-3 px-4 cursor-pointer hover:bg-white/10 first:rounded-t-lg last:rounded-b-lg"
                  >
                    {container.key}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-row gap-2 mt-1 flex-shrink-0">
        <button
          onClick={() => setSelectedMetric("overall")}
          className={`w-30 border rounded-xl p-1 text-center flex flex-row justify-center items-center gap-1 transition-colors ${
            selectedMetric === "overall"
              ? "bg-gray-500 border-gray-500 text-white"
              : "border-white text-white hover:bg-white/10"
          }`}
        >
          <LayoutGrid size={16} />
          <p className="text-md">Overall</p>
        </button>
        <button
          onClick={() => setSelectedMetric("cpu")}
          className={`w-30 border rounded-xl p-1 text-center flex flex-row justify-center items-center gap-1 transition-colors ${
            selectedMetric === "cpu"
              ? "bg-blue-500 border-blue-500 text-white"
              : "border-white text-white hover:bg-white/10"
          }`}
        >
          <Cpu size={16} />
          <p className="text-md">CPU</p>
        </button>
        <button
          onClick={() => setSelectedMetric("memory")}
          className={`w-30 border rounded-xl p-1 text-center flex flex-row justify-center items-center gap-1 transition-colors ${
            selectedMetric === "memory"
              ? "bg-green-500 border-green-500 text-white"
              : "border-white text-white hover:bg-white/10"
          }`}
        >
          <MemoryStick size={16} />
          <p className="text-md">Memory</p>
        </button>
        <button
          onClick={() => setSelectedMetric("network")}
          className={`w-30 border rounded-xl p-1 text-center flex flex-row justify-center items-center gap-1 transition-colors ${
            selectedMetric === "network"
              ? "bg-orange-500 border-orange-500 text-white"
              : "border-white text-white hover:bg-white/10"
          }`}
        >
          <Network size={16} />
          <p className="text-md">Network</p>
        </button>
        <button
          onClick={() => setSelectedMetric("disk")}
          className={`w-30 border rounded-xl p-1 text-center flex flex-row justify-center items-center gap-1 transition-colors ${
            selectedMetric === "disk"
              ? "bg-red-500 border-red-500 text-white"
              : "border-white text-white hover:bg-white/10"
          }`}
        >
          <HardDrive size={16} />
          <p className="text-md">Disk</p>
        </button>
        <button
          onClick={() => setSelectedMetric("latency")}
          className={`w-30 border rounded-xl p-1 text-center flex flex-row justify-center items-center gap-1 transition-colors ${
            selectedMetric === "latency"
              ? "bg-purple-500 border-purple-500 text-white"
              : "border-white text-white hover:bg-white/10"
          }`}
        >
          <Timer size={16} />
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
            <div className="flex flex-row items-center gap-2 mb-2">
              <Activity size={16} className="text-blue-400" />
              <p className="text-gray-400 text-sm font-medium">Current</p>
            </div>
            <p className="text-white text-xl font-semibold">
              {currentMetric.current}
              {suffix}
            </p>
          </div>
          <div className="flex flex-col border border-[#5D5A5A] rounded-xl p-3 flex-1">
            <div className="flex flex-row items-center gap-2 mb-2">
              <BarChart3 size={16} className="text-green-400" />
              <p className="text-gray-400 text-sm font-medium">Average</p>
            </div>
            <p className="text-white text-xl font-semibold">
              {currentMetric.average}
              {suffix}
            </p>
          </div>
          <div className="flex flex-col border border-[#5D5A5A] rounded-xl p-3 flex-1">
            <div className="flex flex-row items-center gap-2 mb-2">
              <TrendingUp size={16} className="text-orange-400" />
              <p className="text-gray-400 text-sm font-medium">Peak</p>
            </div>
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
