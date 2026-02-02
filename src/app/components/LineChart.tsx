"use client";

import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";
import { GitCommitHorizontal } from "lucide-react";
export default function LineChart() {
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
        labels: ["10:00", "10:01", "10:02", "10:03", "10:04"],
        datasets: [
          {
            label: "CPU Usage (%)",
            data: [
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
            ],
            borderColor: "rgb(75, 192, 192)",
            tension: 0.4,
          },
          {
            label: "Memory Usage (%)",
            data: [
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
            ],
            borderColor: "rgb(255, 99, 132)",
            tension: 0.4,
          },
          {
            label: "Network (%)",
            data: [
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
            ],
            borderColor: "rgb(255, 193, 7)",
            tension: 0.4,
          },
          {
            label: "Disk Usage (%)",
            data: [
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
            ],
            borderColor: "rgb(76, 175, 80)",
            tension: 0.4,
          },
          {
            label: "Request Rate",
            data: [
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
              Math.floor(Math.random() * 100),
            ],
            borderColor: "rgb(156, 39, 176)",
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
  }, []);

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
            <h1 className="text-md text-green-500 font-bold">57.6%</h1>
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
            <h1 className="text-md text-red-500 font-bold">45.2%</h1>
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
            <h1 className="text-md text-yellow-500 font-bold">32.8%</h1>
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
            <h1 className="text-md text-green-500 font-bold">68.1%</h1>
          </div>
        </div>
      </div>
    </div>
  );
}
