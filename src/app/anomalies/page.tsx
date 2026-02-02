import React from "react";
import Nav from "../components/Nav";
import KubernetesTerminal from "./KubernetesTerminal";

function AnomaliesPage() {
  return (
    <div className="w-full h-screen flex flex-col bg-[#161C27] overflow-hidden">
      <Nav />

      <div className="p-8 flex-1 grid grid-cols-3 gap-6 overflow-hidden min-h-0">
        {/* Left side - Terminal (2/3) */}
        <div className="col-span-2 border border-[#5D5A5A] rounded-2xl p-6 bg-[#FFFFFF]/[0.02] min-h-0 h-full flex flex-col overflow-hidden">
          <h2 className="text-white font-bold text-lg mb-4">Terminal</h2>
          <div className="flex-1 min-h-0 p-4">
            <KubernetesTerminal />
          </div>
        </div>

        {/* Right side - 2 rows (1/3) */}
        <div className="col-span-1 grid grid-rows-2 gap-6 min-h-0 h-full">
          {/* Anomaly Preview */}
          <div className="border border-[#5D5A5A] rounded-2xl p-6 bg-[#FFFFFF]/[0.02] overflow-hidden">
            <h2 className="text-white font-bold text-lg">Anomaly Preview</h2>
          </div>

          {/* Anomaly Metrics */}
          <div className="border border-[#5D5A5A] rounded-2xl p-6 bg-[#FFFFFF]/[0.02] overflow-hidden">
            <h2 className="text-white font-bold text-lg">Anomaly Metrics</h2>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnomaliesPage;
