"use client";

import React from "react";
import Nav from "../components/Nav";
import AnomalyMetrics from "./AnomalyMetrics";
import AnomalyPreview from "./AnomalyPreview";
import KubernetesTerminal from "./KubernetesTerminal";
import { useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";

function AnomaliesPage() {
  const searchParams = useSearchParams();
  const service = searchParams.get("service") || "";
  const severity = searchParams.get("severity") || "";
  const metric = searchParams.get("metric") || "";
  const description = searchParams.get("description") || "";
  const baseline = searchParams.get("baseline") || "";
  const current = searchParams.get("current") || "";

  return (
    <div className="w-full h-screen flex flex-col bg-[#161C27] overflow-hidden">
      <Nav />

      <div className="p-8 flex-1 grid grid-cols-3 gap-6 overflow-hidden min-h-0">
        {/* Left side - Terminal (2/3) */}
        <div className="col-span-2 border border-[#5D5A5A] rounded-2xl p-6 bg-[#FFFFFF]/[0.02] min-h-0 h-full flex flex-col overflow-hidden">
          <h2 className="text-white font-bold text-lg mb-4">
            Terminal {service && `- ${service}`}
          </h2>
          <div className="flex-1 min-h-0 p-4">
            <KubernetesTerminal service={service} />
          </div>
        </div>

        {/* Right side - 2 rows (1/3) */}
        <div className="col-span-1 grid grid-rows-2 gap-6 min-h-0 h-full">
          <AnomalyPreview
            service={service}
            severity={severity}
            description={description}
          />
          <AnomalyMetrics
            metric={metric}
            baseline={baseline}
            current={current}
          />
        </div>
      </div>
    </div>
  );
}

export default AnomaliesPage;
