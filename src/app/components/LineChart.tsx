"use client";

import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { GitCommitHorizontal } from "lucide-react";

type DashboardService = {
  id: string;
  name: string;
  cpuCores: number;
  memoryMiB: number;
  requestRate: number;
};

export default function LineChart({ services }: { services: DashboardService[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels: services.map((service) => service.name),
        datasets: [
          {
            label: "CPU",
            data: services.map((service) => Number(service.cpuCores.toFixed(3))),
            borderColor: "rgb(75, 192, 192)",
            tension: 0.4,
          },
          {
            label: "Memory MiB",
            data: services.map((service) => Number(service.memoryMiB.toFixed(2))),
            borderColor: "rgb(255, 99, 132)",
            tension: 0.4,
          },
          {
            label: "Request Rate",
            data: services.map((service) => Number(service.requestRate.toFixed(2))),
            borderColor: "rgb(255, 193, 7)",
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
  }, [services]);

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
          {services.slice(0, 5).map((service) => (
            <div className="flex flex-row " key={service.id}>
              <GitCommitHorizontal color="blue" />
              <p className="text-blue-400 text-s">{service.name}</p>
            </div>
          ))}
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
              {services.reduce((sum, service) => sum + service.cpuCores, 0).toFixed(3)}
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
              {services.reduce((sum, service) => sum + service.memoryMiB, 0).toFixed(1)}
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
              {services.reduce((sum, service) => sum + service.requestRate, 0).toFixed(2)}
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
            <h1 className="text-md text-green-500 font-bold">{services.length}</h1>
          </div>
        </div>
      </div>
    </div>
  );
}
