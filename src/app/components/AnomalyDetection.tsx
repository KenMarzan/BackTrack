"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

interface Anomaly {
  service: string;
  severity: "CRITICAL" | "HIGH" | "WARNING";
  metric: string;
  baseline: string;
  current: string;
  description: string;
  timestamp: string;
}

function AnomalyDetection() {
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

  const countBySeverity = (severity: string) =>
    anomalies.filter((a) => a.severity === severity).length;

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
        return {
          bg: "bg-red-500/10",
          border: "border-red-500/30",
          text: "text-red-400",
          badge: "bg-red-500",
        };
      case "HIGH":
        return {
          bg: "bg-orange-500/10",
          border: "border-orange-500/30",
          text: "text-orange-400",
          badge: "bg-orange-500",
        };
      case "WARNING":
        return {
          bg: "bg-yellow-500/10",
          border: "border-yellow-500/30",
          text: "text-yellow-400",
          badge: "bg-yellow-500",
        };
      default:
        return {
          bg: "bg-gray-500/10",
          border: "border-gray-500/30",
          text: "text-gray-400",
          badge: "bg-gray-500",
        };
    }
  };

  const getAlertColor = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
        return "red";
      case "HIGH":
        return "orange";
      case "WARNING":
        return "#FFDD00";
      default:
        return "gray";
    }
  };
  return (
    <div className="border border-[#5D5A5A] rounded-2xl p-6 bg-[#F01010]/[0.02] h-full flex flex-col overflow-hidden">
      <div className="flex flex-row justify-between items-center mb-5 flex-shrink-0">
        <h1 className="text-white font-bold text-xl mb-4">Anomaly Detection</h1>
        <div className="flex flex-row gap-4">
          <div className="w-15 h-14 border border-[#FF0000] bg-[#DC0E0E]/10 text-center rounded-md">
            <h1 className="text-red-600 text-2xl font-bold">
              {countBySeverity("CRITICAL")}
            </h1>
            <h1 className="text-xs text-white">Critical</h1>
          </div>
          <div className="w-15 h-14 border bg-[#EE9B00]/10 border-[#FF9D00] text-center rounded-md">
            <h1 className="text-[#FFA600] text-2xl font-bold">
              {countBySeverity("HIGH")}
            </h1>
            <h1 className="text-xs text-white">High</h1>
          </div>
          <div className="w-15 h-14 border bg-[#E2D710]/10 border-[#CA9E0D] text-center rounded-md">
            <h1 className="text-[#FFDD00] text-2xl font-bold">
              {countBySeverity("WARNING")}
            </h1>
            <h1 className="text-xs text-white">Warning</h1>
          </div>
        </div>
      </div>
      <div className="space-y-3 overflow-y-auto flex-1 min-h-0 scrollbar-hide">
        {loading ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-gray-400">Loading anomalies...</p>
          </div>
        ) : anomalies.length === 0 ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-gray-400">No anomalies detected</p>
          </div>
        ) : (
          <>
            {anomalies.map((anomaly, idx) => {
              const colors = getSeverityColor(anomaly.severity);
              return (
                <div
                  key={idx}
                  className={`${colors.bg} border ${colors.border} rounded p-3`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex flex-row items-center gap-2">
                      <TriangleAlert
                        size={15}
                        color={getAlertColor(anomaly.severity)}
                      />
                      <div>
                        <div className="flex flex-row gap-2">
                          <p className={`${colors.text} font-semibold`}>
                            {anomaly.service}
                          </p>
                          <div
                            className={`${colors.badge} w-20 p-1 text-center rounded-md`}
                          >
                            <p className="text-white text-sm">
                              {anomaly.severity}
                            </p>
                          </div>
                        </div>
                        <p className="text-gray-400 text-xs">
                          {anomaly.description}
                        </p>
                      </div>
                    </div>
                    <span className="text-gray-400 text-xs">
                      {new Date(anomaly.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <hr className="border-[#5D5A5A] my-2" />
                  <div className="flex justify-between text-xs text-gray-400 mt-2">
                    <span>
                      Metric:{" "}
                      <span className={colors.text}>{anomaly.metric}</span>
                    </span>
                    <span>
                      Baseline:{" "}
                      <span className="text-gray-300">{anomaly.baseline}</span>
                    </span>
                    <span>
                      Current:{" "}
                      <span className={colors.text}>{anomaly.current}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

export default AnomalyDetection;
