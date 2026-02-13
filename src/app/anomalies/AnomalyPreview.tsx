"use client";

import { useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";

interface Anomaly {
  service: string;
  severity: "CRITICAL" | "HIGH" | "WARNING";
  metric: string;
  baseline: string;
  current: string;
  description: string;
  timestamp: string;
}

const severityStyles = {
  CRITICAL: {
    border: "border-red-500/40",
    bg: "bg-red-500/15",
    text: "text-red-300",
    badge: "bg-red-500/30 text-red-200",
  },
  HIGH: {
    border: "border-orange-500/40",
    bg: "bg-orange-500/15",
    text: "text-orange-300",
    badge: "bg-orange-500/30 text-orange-200",
  },
  WARNING: {
    border: "border-yellow-500/40",
    bg: "bg-yellow-500/15",
    text: "text-yellow-200",
    badge: "bg-yellow-500/30 text-yellow-100",
  },
} as const;

const formatTimeAgo = (timestamp: string) => {
  const now = Date.now();
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return "Just now";
  const diffSeconds = Math.max(0, Math.floor((now - time) / 1000));
  if (diffSeconds < 60) return "Just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

interface AnomalyPreviewProps {
  service?: string;
  severity?: string;
  description?: string;
}

export default function AnomalyPreview({
  service,
  severity,
  description,
}: AnomalyPreviewProps) {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(true);
  const [highlightedService, setHighlightedService] = useState<string | null>(
    service || null,
  );

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

  const previewItems = useMemo(() => anomalies.slice(0, 6), [anomalies]);

  return (
    <div className="border border-[#5D5A5A] rounded-2xl p-6 bg-[#FFFFFF]/[0.02] h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 mb-4">
        <TriangleAlert size={18} color="#60A5FA" />
        <h2 className="text-white font-bold text-lg">Anomaly Preview</h2>
      </div>

      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto scrollbar-hide">
        {loading ? (
          <div className="text-gray-400 text-sm text-center py-8">
            Loading anomalies...
          </div>
        ) : previewItems.length === 0 ? (
          <div className="text-gray-400 text-sm text-center py-8">
            No anomalies detected
          </div>
        ) : (
          previewItems.map((anomaly, index) => {
            const styles =
              severityStyles[anomaly.severity] ?? severityStyles.WARNING;
            return (
              <div
                key={`${anomaly.service}-${index}`}
                className={`rounded-xl border ${styles.border} ${styles.bg} px-4 py-3 ${highlightedService === anomaly.service ? "ring-2 ring-blue-500" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-semibold">
                      {anomaly.service}
                    </p>
                    <p className="text-gray-300 text-xs">
                      {anomaly.metric} · {anomaly.current}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${styles.badge}`}
                    >
                      {anomaly.severity}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {formatTimeAgo(anomaly.timestamp)}
                    </span>
                  </div>
                </div>
                <p className={`text-xs mt-2 ${styles.text}`}>
                  {anomaly.description}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
