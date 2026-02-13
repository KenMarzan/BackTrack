"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity } from "lucide-react";

interface Anomaly {
  severity: "CRITICAL" | "HIGH" | "WARNING";
  timestamp: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const arcPath = (
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
) => {
  const start = {
    x: cx + r * Math.cos(startAngle),
    y: cy + r * Math.sin(startAngle),
  };
  const end = {
    x: cx + r * Math.cos(endAngle),
    y: cy + r * Math.sin(endAngle),
  };
  const largeArcFlag = endAngle - startAngle <= Math.PI ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
};

interface AnomalyMetricsProps {
  metric?: string;
  baseline?: string;
  current?: string;
}

export default function AnomalyMetrics({
  metric,
  baseline,
  current,
}: AnomalyMetricsProps) {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAnomalies = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/anomalies");
        const data = await response.json();
        setAnomalies(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Failed to fetch anomalies:", error);
        setAnomalies([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAnomalies();
    const interval = setInterval(fetchAnomalies, 30000);
    return () => clearInterval(interval);
  }, []);

  const detectionRate = useMemo(() => {
    if (anomalies.length === 0) return 0;
    const critical = anomalies.filter((a) => a.severity === "CRITICAL").length;
    const high = anomalies.filter((a) => a.severity === "HIGH").length;
    const warning = anomalies.filter((a) => a.severity === "WARNING").length;
    const score = critical * 25 + high * 15 + warning * 8;
    return clamp(score, 0, 100);
  }, [anomalies]);

  const needleRotation = -90 + (detectionRate / 100) * 180;
  const rateLabel = detectionRate.toFixed(1);

  return (
    <div className="border border-[#5D5A5A] rounded-2xl p-6 bg-[#FFFFFF]/[0.02] h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 mb-4">
        <Activity size={18} color="#60A5FA" />
        <h2 className="text-white font-bold text-lg">Anomaly Metrics</h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-between gap-4 min-h-0">
        <div className="relative w-full max-w-[260px] flex-1 flex items-center justify-center">
          <svg viewBox="0 0 200 120" className="w-full max-h-[200px]">
            <path
              d={arcPath(100, 100, 80, Math.PI, Math.PI * 1.2)}
              stroke="#EF4444"
              strokeWidth="14"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d={arcPath(100, 100, 80, Math.PI * 1.2, Math.PI * 1.4)}
              stroke="#F97316"
              strokeWidth="14"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d={arcPath(100, 100, 80, Math.PI * 1.4, Math.PI * 1.6)}
              stroke="#F59E0B"
              strokeWidth="14"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d={arcPath(100, 100, 80, Math.PI * 1.6, Math.PI * 1.8)}
              stroke="#84CC16"
              strokeWidth="14"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d={arcPath(100, 100, 80, Math.PI * 1.8, Math.PI * 2)}
              stroke="#22C55E"
              strokeWidth="14"
              fill="none"
              strokeLinecap="round"
            />
            <circle cx="100" cy="100" r="6" fill="#E5E7EB" />
            <line
              x1="100"
              y1="100"
              x2="100"
              y2="30"
              stroke="#E5E7EB"
              strokeWidth="3"
              strokeLinecap="round"
              transform={`rotate(${needleRotation} 100 100)`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pt-8">
            <span className="text-2xl font-bold text-green-400">
              {loading ? "--" : rateLabel}%
            </span>
            <span className="text-xs text-gray-400">
              Anomaly Detection Rate
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px]">
          <div className="flex flex-col items-center px-3 py-2 rounded-lg border border-green-500/30 bg-green-500/10">
            <span className="text-green-300">Low</span>
            <span className="text-gray-400">0-33%</span>
          </div>
          <div className="flex flex-col items-center px-3 py-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
            <span className="text-yellow-200">Medium</span>
            <span className="text-gray-400">34-66%</span>
          </div>
          <div className="flex flex-col items-center px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10">
            <span className="text-red-300">High</span>
            <span className="text-gray-400">67-100%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
