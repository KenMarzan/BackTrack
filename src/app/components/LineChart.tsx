"use client";

import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";
import { GitCommitHorizontal } from "lucide-react";

interface MetricsData {
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

interface LineChartProps {
  data?: { time: string; value: number }[];
  color?: string;
  selectedMetric?:
    | "overall"
    | "cpu"
    | "memory"
    | "network"
    | "disk"
    | "latency";
  metricsData?: MetricsData;
}

export default function LineChart({
  data,
  color,
  selectedMetric,
  metricsData: propMetricsData,
}: LineChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const [metricsData, setMetricsData] = useState<MetricsData | null>(null);

  // Only fetch metrics if not receiving data as props (standalone mode)
  const isStandalone = !data;

  useEffect(() => {
    if (isStandalone) {
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
    }
  }, [isStandalone]);

  useEffect(() => {
    if (!canvasRef.current) return;

    // If using props (ContainerHealth mode)
    if (data && color) {
      if (chartRef.current) {
        chartRef.current.destroy();
      }

      // Check if this is "overall" mode with propMetricsData
      if (selectedMetric === "overall" && propMetricsData) {
        chartRef.current = new Chart(canvasRef.current, {
          type: "line",
          data: {
            labels: propMetricsData.labels,
            datasets: [
              {
                label: "CPU Usage (%)",
                data: propMetricsData.timeSeries.cpu.map((d) => d.value),
                borderColor: "#3B82F6",
                borderWidth: 1,
                tension: 0.4,
                fill: false,
              },
              {
                label: "Memory Usage (%)",
                data: propMetricsData.timeSeries.memory.map((d) => d.value),
                borderColor: "#10B981",
                borderWidth: 1,
                tension: 0.4,
                fill: false,
              },
              {
                label: "Network I/O",
                data: propMetricsData.timeSeries.network.map((d) => d.value),
                borderColor: "#F59E0B",
                borderWidth: 1,
                tension: 0.4,
                fill: false,
              },
              {
                label: "Disk I/O",
                data: propMetricsData.timeSeries.disk.map((d) => d.value),
                borderColor: "#EF4444",
                borderWidth: 1,
                tension: 0.4,
                fill: false,
              },
              {
                label: "Request Rate",
                data: propMetricsData.timeSeries.requestRate.map(
                  (d) => d.value,
                ),
                borderColor: "#8B5CF6",
                borderWidth: 2,
                tension: 0.4,
                fill: false,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: true,
                position: "bottom",
                labels: {
                  color: "#fff",
                  usePointStyle: true,
                  padding: 15,
                },
              },
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  color: "#fff",
                },
                grid: {
                  color: "rgba(255, 255, 255, 0.1)",
                },
              },
              x: {
                ticks: {
                  color: "#fff",
                },
                grid: {
                  color: "rgba(255, 255, 255, 0.1)",
                },
              },
            },
          },
        });
      } else {
        // Single metric mode
        chartRef.current = new Chart(canvasRef.current, {
          type: "line",
          data: {
            labels: data.map((d) => d.time),
            datasets: [
              {
                label: selectedMetric || "Metric",
                data: data.map((d) => d.value),
                borderColor: color,
                borderWidth: 2,
                tension: 0.4,
                fill: false,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: false,
              },
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  color: "#fff",
                },
                grid: {
                  color: "rgba(255, 255, 255, 0.1)",
                },
              },
              x: {
                ticks: {
                  color: "#fff",
                },
                grid: {
                  color: "rgba(255, 255, 255, 0.1)",
                },
              },
            },
          },
        });
      }

      return () => {
        chartRef.current?.destroy();
      };
    }

    // Standalone mode with full metrics
    if (!metricsData) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: metricsData.labels,
        datasets: [
          {
            label: "CPU Usage (%)",
            data: metricsData.timeSeries.cpu.map((d) => d.value),
            borderColor: "rgb(75, 192, 192)",
            borderWidth: 2,
            tension: 0.4,
          },
          {
            label: "Memory Usage (%)",
            data: metricsData.timeSeries.memory.map((d) => d.value),
            borderColor: "rgb(255, 99, 132)",
            borderWidth: 2,
            tension: 0.4,
          },
          {
            label: "Network (%)",
            data: metricsData.timeSeries.network.map((d) => d.value),
            borderColor: "rgb(255, 193, 7)",
            borderWidth: 2,
            tension: 0.4,
          },
          {
            label: "Disk Usage (%)",
            data: metricsData.timeSeries.disk.map((d) => d.value),
            borderColor: "rgb(76, 175, 80)",
            borderWidth: 2,
            tension: 0.4,
          },
          {
            label: "Request Rate",
            data: metricsData.timeSeries.requestRate.map((d) => d.value),
            borderColor: "rgb(156, 39, 176)",
            borderWidth: 2,
            tension: 0.4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
    };
  }, [data, color, metricsData, selectedMetric, propMetricsData]);

  // ContainerHealth mode - no extra UI
  if (data && color) {
    return <canvas ref={canvasRef} />;
  }

  // Standalone mode - full UI with boxes
  return (
    <div className="bg-slate-900 p-4 rounded-lg min-h-48">
      <div className="flex items-center h-48">
        <p className="text-gray-200 [writing-mode:vertical-rl] rotate-180 text-s">
          CPU usage
        </p>
        <canvas ref={canvasRef} />
      </div>

      <div className="flex  flex-col items-center justify-center gap-1">
        <div className="flex flex-row gap-4">
          <div className="flex flex-row ">
            <GitCommitHorizontal color="blue" />
            <p className="text-blue-400 text-s">api-gateway</p>
          </div>
          <div className="flex flex-row ">
            <GitCommitHorizontal color="blue" />
            <p className="text-blue-400 text-s">api-gateway</p>
          </div>
          <div className="flex flex-row ">
            <GitCommitHorizontal color="blue" />
            <p className="text-blue-400 text-s">api-gateway</p>
          </div>
          <div className="flex flex-row ">
            <GitCommitHorizontal color="blue" />
            <p className="text-blue-400 text-s">api-gateway</p>
          </div>
          <div className="flex flex-row ">
            <GitCommitHorizontal color="blue" />
            <p className="text-blue-400 text-s">api-gateway</p>
          </div>
        </div>
        <div className="w-[70%] h-0 border border-gray-500"></div>
      </div>
      <div className="flex justify-center gap-10 mt-4">
        <div className="w-60 flex items-center gap-4 border-2 border-[#9C9C9C] px-3 p-1 rounded bg-[#ffff]/4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="white"
            className="size-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
            />
          </svg>
          <div>
            <span className="text-white text-sm">CPU Usage (%)</span>
            <h1 className="text-md text-green-500 font-bold">
              {metricsData?.current.cpu || "57.6"}%
            </h1>
          </div>
        </div>
        <div className="w-60 flex items-center gap-4 border-2 border-[#9C9C9C] px-3 p-1 rounded bg-[#ffff]/4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="white"
            className="size-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
            />
          </svg>
          <div>
            <span className="text-white text-sm">Memory Usage (%)</span>
            <h1 className="text-md text-red-500 font-bold">
              {metricsData?.current.memory || "45.2"}%
            </h1>
          </div>
        </div>
        <div className="w-60 flex items-center gap-4 border-2 border-[#9C9C9C] px-3 p-1 rounded bg-[#ffff]/4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="white"
            className="size-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
            />
          </svg>
          <div>
            <span className="text-white text-sm">Network (%)</span>
            <h1 className="text-md text-yellow-500 font-bold">
              {metricsData?.current.network || "32.8"}%
            </h1>
          </div>
        </div>
        <div className="w-60 flex items-center gap-4 border-2 border-[#9C9C9C] px-3 p-1 rounded bg-[#ffff]/4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="white"
            className="size-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
            />
          </svg>
          <div>
            <span className="text-white text-sm">Disk Usage (%)</span>
            <h1 className="text-md text-green-500 font-bold">
              {metricsData?.current.disk || "68.1"}%
            </h1>
          </div>
        </div>
      </div>
    </div>
  );
}
