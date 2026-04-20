import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { DashboardAnomaly } from "@/lib/monitoring-types";

function AnomalyDetection({ anomalies }: { anomalies: DashboardAnomaly[] }) {
  const critical = anomalies.filter((anomaly) => anomaly.severity === "critical").length;
  const high = anomalies.filter((anomaly) => anomaly.severity === "high").length;
  const warning = anomalies.filter((anomaly) => anomaly.severity === "warning").length;

  return (
    <div className="border border-[#5D5A5A] rounded-2xl p-6 bg-[#F01010]/[0.02] h-full flex flex-col overflow-hidden">
      <div className="flex flex-row justify-between items-center mb-5 flex-shrink-0">
        <h1 className="text-white font-bold text-xl mb-4">Anomaly Detection</h1>
        <div className="flex flex-row gap-4">
          <div className="w-15 h-14 border border-[#FF0000] bg-[#DC0E0E]/10 text-center rounded-md">
            <h1 className="text-red-600 text-2xl font-bold">{critical}</h1>
            <h1 className="text-xs text-white">Critical</h1>
          </div>
          <div className="w-15 h-14 border bg-[#EE9B00]/10 border-[#FF9D00] text-center rounded-md">
            <h1 className="text-[#FFA600] text-2xl font-bold">{high}</h1>
            <h1 className="text-xs text-white">High</h1>
          </div>
          <div className="w-15 h-14 border bg-[#E2D710]/10 border-[#CA9E0D] text-center rounded-md">
            <h1 className="text-[#FFDD00] text-2xl font-bold">{warning}</h1>
            <h1 className="text-xs text-white">Warning</h1>
          </div>
        </div>
      </div>
      <div className="space-y-3 overflow-y-auto flex-1 min-h-0 scrollbar-hide">
        {anomalies.length === 0 ? (
          <div className="bg-green-500/10 border border-green-500/30 rounded p-3">
            <p className="text-green-400 text-sm">
              No active anomalies detected.
            </p>
          </div>
        ) : (
          anomalies.map((anomaly) => {
            const color = anomaly.severity === "critical"
              ? "red"
              : anomaly.severity === "high"
                ? "orange"
                : "#FFDD00";

            const badgeClass = anomaly.severity === "critical"
              ? "bg-red-500"
              : anomaly.severity === "high"
                ? "bg-orange-500"
                : "bg-yellow-500";

            const textClass = anomaly.severity === "critical"
              ? "text-red-400"
              : anomaly.severity === "high"
                ? "text-orange-400"
                : "text-yellow-400";

            const diagnosticHref = `/anomalies/${encodeURIComponent(anomaly.service)}?namespace=${encodeURIComponent(anomaly.namespace)}&severity=${encodeURIComponent(anomaly.severity)}&metric=${encodeURIComponent(anomaly.metric)}&current=${encodeURIComponent(anomaly.current)}&baseline=${encodeURIComponent(anomaly.baseline)}&message=${encodeURIComponent(anomaly.message)}`;

            return (
              <Link
                href={diagnosticHref}
                className="block bg-red-500/10 border border-red-500/30 rounded p-3 hover:bg-red-500/15 transition"
                key={anomaly.id}
              >
                <div className="flex items-center justify-between">
                  <div className="flex flex-row items-center gap-2 ">
                    <div>
                      <TriangleAlert size={15} color={color} />
                    </div>
                    <div>
                      <div className="flex flex-row gap-2">
                        <p className={`${textClass} font-semibold`}>{anomaly.service}</p>
                        <div className={`${badgeClass} w-20 p-1 text-center rounded-md `}>
                          <p className="text-white text-sm">{anomaly.severity.toUpperCase()}</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-gray-300 text-xs">{anomaly.message}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <hr className="border-[#5D5A5A] my-2" />
                <div className="flex justify-between text-xs text-gray-400 mt-2">
                  <span>
                    Metric: <span className={textClass}>{anomaly.metric}</span>
                  </span>
                  <span>
                    Baseline: <span className="text-gray-300">{anomaly.baseline}</span>
                  </span>
                  <span>
                    Current: <span className={textClass}>{anomaly.current}</span>
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

export default AnomalyDetection;
