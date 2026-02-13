"use client";

import Nav from "./components/Nav";
import ContainerHealth from "./components/ContainerHealth";
import RecentDeployment from "./components/RecentDeployment";
import ActiveContainers from "./components/ActiveContainers";
import AnomalyDetection from "./components/AnomalyDetection";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

export default function Home() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState("10s");
  const [isIntervalDropdownOpen, setIsIntervalDropdownOpen] = useState(false);

  const intervalOptions = [
    { label: "5s", value: "5s" },
    { label: "10s", value: "10s" },
    { label: "15s", value: "15s" },
    { label: "20s", value: "20s" },
    { label: "1m", value: "1m" },
    { label: "5m", value: "5m" },
  ];

  const handleRefresh = () => {
    setIsRefreshing(true);
    setRefreshKey((prev) => prev + 1);
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  return (
    <div className="w-full h-screen flex flex-col bg-[#161C27] overflow-hidden">
      <Nav />

      <div className="p-8 flex-1 grid grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-4 overflow-visible min-h-0">
        <div className="flex flex-row justify-end gap-2 relative z-50">
          <div className="flex flex-row border rounded-xl border-[#5D5A5A] bg-[#1a2332] shadow-lg">
            <button
              onClick={handleRefresh}
              className="flex flex-row gap-2 items-center px-4 py-2 text-white hover:bg-white/10 transition-colors border-r border-[#5D5A5A]"
            >
              <RefreshCw
                strokeWidth={2}
                size={18}
                className={isRefreshing ? "animate-spin" : ""}
              />
              <span className="font-medium">Refresh</span>
            </button>

            <div className="relative">
              <div
                className="flex items-center gap-2 px-4 py-2 min-w-[70px] cursor-pointer hover:bg-white/10 transition-colors"
                onClick={() =>
                  setIsIntervalDropdownOpen(!isIntervalDropdownOpen)
                }
              >
                <span className="text-white font-medium">
                  {refreshInterval}
                </span>
                <svg
                  className={`w-4 h-4 text-white transition-transform ${isIntervalDropdownOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>

              {isIntervalDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 bg-[#1a2332] rounded-lg shadow-xl z-[100] min-w-[100px] border border-[#5D5A5A]">
                  {intervalOptions.map((option) => (
                    <div
                      key={option.value}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRefreshInterval(option.value);
                        setIsIntervalDropdownOpen(false);
                      }}
                      className={`text-white text-sm py-2.5 px-4 cursor-pointer hover:bg-white/15 transition-colors first:rounded-t-lg last:rounded-b-lg ${
                        refreshInterval === option.value
                          ? "bg-blue-500/30 font-medium"
                          : ""
                      }`}
                    >
                      {option.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Grid container below the navbar */}
        <div className="grid grid-cols-3 w-full gap-20 min-h-0 h-full">
          {/* 2/3 Column */}
          <ContainerHealth key={`container-${refreshKey}`} />

          {/* 1/3 Column */}
          <RecentDeployment key={`deployment-${refreshKey}`} />
        </div>

        {/* Bottom row - Anomaly Detection and Active Containers */}
        <div className="grid grid-cols-2 w-full gap-20 min-h-0 h-full">
          <AnomalyDetection key={`anomaly-${refreshKey}`} />
          <ActiveContainers key={`active-${refreshKey}`} />
        </div>
      </div>
    </div>
  );
}
