"use client";

import { useEffect, useRef } from "react";
import Chart from "chart.js/auto";

type TrendDataset = {
  label: string;
  data: number[];
  borderColor: string;
};

type LineChartProps = {
  labels: string[];
  datasets: TrendDataset[];
  yAxisLabel: string;
};

export default function LineChart({ labels, datasets, yAxisLabel }: LineChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    if (chartRef.current) {
      const chart = chartRef.current;
      chart.data.labels = labels;
      chart.data.datasets = datasets.map((dataset) => ({
        label: dataset.label,
        data: dataset.data,
        borderColor: dataset.borderColor,
        pointBackgroundColor: dataset.borderColor,
        pointBorderColor: dataset.borderColor,
        pointRadius: 3,
        borderWidth: 2,
        tension: 0.35,
        fill: false,
      }));
      const yScale = chart.options.scales?.y as { title?: { text?: string } } | undefined;
      if (yScale?.title) {
        yScale.title.text = yAxisLabel;
      }
      chart.update("none");
      return;
    }

    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: datasets.map((dataset) => ({
          label: dataset.label,
          data: dataset.data,
          borderColor: dataset.borderColor,
          pointBackgroundColor: dataset.borderColor,
          pointBorderColor: dataset.borderColor,
          pointRadius: 3,
          borderWidth: 2,
          tension: 0.35,
          fill: false,
        })),
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
          x: {
            ticks: { color: "#E5E7EB" },
            grid: { color: "rgba(148, 163, 184, 0.35)" },
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#E5E7EB" },
            grid: { color: "rgba(148, 163, 184, 0.35)" },
            title: {
              display: true,
              text: yAxisLabel,
              color: "#E5E7EB",
            },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [datasets, labels, yAxisLabel]);

  return (
    <div className="h-full w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
