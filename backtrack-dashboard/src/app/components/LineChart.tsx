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

function readChartTheme() {
  const s = getComputedStyle(document.documentElement);
  return {
    tick: s.getPropertyValue("--chart-tick").trim() || "#6b7689",
    grid: s.getPropertyValue("--chart-grid").trim() || "rgba(148, 163, 184, 0.07)",
    axis: s.getPropertyValue("--chart-axis").trim() || "rgba(148, 163, 184, 0.1)",
    axisTitle: s.getPropertyValue("--chart-axis-title").trim() || "#a5b0c2",
  };
}

function applyChartTheme(chart: Chart, yAxisLabel: string) {
  const theme = readChartTheme();
  const x = chart.options.scales?.x as { ticks?: { color?: string }; grid?: { color?: string }; border?: { color?: string } } | undefined;
  const y = chart.options.scales?.y as { ticks?: { color?: string }; grid?: { color?: string }; border?: { color?: string }; title?: { text?: string; color?: string } } | undefined;
  if (x?.ticks) x.ticks.color = theme.tick;
  if (x?.grid) x.grid.color = theme.grid;
  if (x?.border) x.border.color = theme.axis;
  if (y?.ticks) y.ticks.color = theme.tick;
  if (y?.grid) y.grid.color = theme.grid;
  if (y?.border) y.border.color = theme.axis;
  if (y?.title) {
    y.title.text = yAxisLabel;
    y.title.color = theme.axisTitle;
  }
  chart.update("none");
}

export default function LineChart({ labels, datasets, yAxisLabel }: LineChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const buildDatasets = (ctx: CanvasRenderingContext2D | null, canvas: HTMLCanvasElement) =>
      datasets.map((dataset) => {
        const h = canvas.clientHeight || 200;
        let bg: CanvasGradient | string = "transparent";
        if (ctx) {
          bg = ctx.createLinearGradient(0, 0, 0, h);
          bg.addColorStop(0, dataset.borderColor + "38");
          bg.addColorStop(1, dataset.borderColor + "00");
        }
        return {
          label: dataset.label,
          data: dataset.data,
          borderColor: dataset.borderColor,
          backgroundColor: bg,
          pointBackgroundColor: dataset.borderColor,
          pointBorderColor: "transparent",
          pointRadius: 2,
          pointHoverRadius: 4,
          borderWidth: 1.5,
          tension: 0.4,
          fill: true,
        };
      });

    if (chartRef.current) {
      const chart = chartRef.current;
      chart.data.labels = labels;
      const ctx2 = canvasRef.current.getContext("2d");
      chart.data.datasets = buildDatasets(ctx2, canvasRef.current);
      applyChartTheme(chart, yAxisLabel);
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const theme = readChartTheme();

    chartRef.current = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: buildDatasets(ctx, canvas),
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
            ticks: { color: theme.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 } },
            grid: { color: theme.grid },
            border: { color: theme.axis },
          },
          y: {
            beginAtZero: true,
            ticks: { color: theme.tick, font: { family: "'IBM Plex Mono', monospace", size: 10 } },
            grid: { color: theme.grid },
            border: { color: theme.axis },
            title: {
              display: true,
              text: yAxisLabel,
              color: theme.axisTitle,
              font: { family: "'IBM Plex Mono', monospace", size: 10 },
            },
          },
        },
      },
    });

    const observer = new MutationObserver(() => {
      if (chartRef.current) applyChartTheme(chartRef.current, yAxisLabel);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      observer.disconnect();
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
