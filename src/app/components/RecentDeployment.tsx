"use client";

import { GitMerge, Triangle, RotateCcw } from "lucide-react";
import { useState } from "react";

function RecentDeployment() {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0);

  const initialDeployments = [
    {
      name: "api-gateway",
      currentVersion: "v2.2.3",
      deployedTime: "2 minutes ago",
      status: "Success",
      deployment: "3/3",
      source: "github actions",
      statusColor: "text-green-500",
      versions: [
        { version: "v2.2.3", status: "Success", time: "2 minutes ago" },
        { version: "v2.2.2", status: "Success", time: "1 hour ago" },
        { version: "v2.2.1", status: "Failed", time: "3 hours ago" },
        { version: "v2.2.0", status: "Success", time: "1 day ago" },
      ],
    },
    {
      name: "database-service",
      currentVersion: "v1.5.2",
      deployedTime: "45 minutes ago",
      status: "Success",
      deployment: "3/3",
      source: "github actions",
      statusColor: "text-green-500",
      versions: [
        { version: "v1.5.2", status: "Success", time: "45 minutes ago" },
        { version: "v1.5.1", status: "Success", time: "4 hours ago" },
        { version: "v1.5.0", status: "Success", time: "1 day ago" },
        { version: "v1.4.9", status: "Failed", time: "2 days ago" },
      ],
    },
    {
      name: "cache-service",
      currentVersion: "v3.1.0",
      deployedTime: "1 hour ago",
      status: "Success",
      deployment: "3/3",
      source: "github actions",
      statusColor: "text-green-500",
      versions: [
        { version: "v3.1.0", status: "Success", time: "1 hour ago" },
        { version: "v3.0.9", status: "Success", time: "3 hours ago" },
        { version: "v3.0.8", status: "Failed", time: "1 day ago" },
        { version: "v3.0.7", status: "Success", time: "2 days ago" },
      ],
    },
    {
      name: "cache-service",
      currentVersion: "v3.1.0",
      deployedTime: "1 hour ago",
      status: "Success",
      deployment: "3/3",
      source: "github actions",
      statusColor: "text-green-500",
      versions: [
        { version: "v3.1.0", status: "Success", time: "1 hour ago" },
        { version: "v3.0.9", status: "Success", time: "3 hours ago" },
        { version: "v3.0.8", status: "Failed", time: "1 day ago" },
        { version: "v3.0.7", status: "Success", time: "2 days ago" },
      ],
    },
    {
      name: "cache-service",
      currentVersion: "v3.1.0",
      deployedTime: "1 hour ago",
      status: "Success",
      deployment: "3/3",
      source: "github actions",
      statusColor: "text-green-500",
      versions: [
        { version: "v3.1.0", status: "Success", time: "1 hour ago" },
        { version: "v3.0.9", status: "Success", time: "3 hours ago" },
        { version: "v3.0.8", status: "Failed", time: "1 day ago" },
        { version: "v3.0.7", status: "Success", time: "2 days ago" },
      ],
    },
    {
      name: "cache-service",
      currentVersion: "v3.1.0",
      deployedTime: "1 hour ago",
      status: "Success",
      deployment: "3/3",
      source: "github actions",
      statusColor: "text-green-500",
      versions: [
        { version: "v3.1.0", status: "Success", time: "1 hour ago" },
        { version: "v3.0.9", status: "Success", time: "3 hours ago" },
        { version: "v3.0.8", status: "Failed", time: "1 day ago" },
        { version: "v3.0.7", status: "Success", time: "2 days ago" },
      ],
    },
  ];

  const [deployments, setDeployments] = useState(initialDeployments);

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  const handleRollback = (deploymentIndex: number, version: string) => {
    setDeployments((prev) =>
      prev.map((deployment, index) => {
        if (index !== deploymentIndex) {
          return deployment;
        }

        return {
          ...deployment,
          currentVersion: version,
          deployedTime: "just now",
          status: "Success",
          statusColor: "text-green-500",
          versions: deployment.versions.map((v) =>
            v.version === version ? { ...v, status: "Success" } : v,
          ),
        };
      }),
    );
  };

  return (
    <div className="col-span-1 p-6 border border-[#5D5A5A] rounded-lg h-full flex flex-col overflow-hidden">
      <div className="flex flex-row gap-2 justify-between mb-4 flex-shrink-0">
        <div className="flex flex-row items-center gap-2">
          <GitMerge color="blue" />
          <h1 className="text-white font-bold text-xl">Recent Deployment</h1>
        </div>
        <div>
          <h1 className="text-green-500 text-sm">85% success rate</h1>
        </div>
      </div>

      <div className="space-y-2 overflow-y-auto scrollbar-hide flex-1 min-h-0">
        {deployments.map((deployment, index) => (
          <div key={index}>
            <button
              onClick={() => toggleExpand(index)}
              className="w-full border border-[#9C9C9C] bg-[#ffffff]/4 rounded-md p-3 hover:bg-[#ffffff]/8 transition text-left"
            >
              <div className="flex flex-row justify-between items-center">
                <div className="flex flex-col gap-2">
                  <h1 className="text-white font-semibold">
                    {deployment.name}
                  </h1>
                  <div className="flex flex-row gap-2 items-center text-xs text-gray-300">
                    <span className="font-mono">
                      {deployment.currentVersion}
                    </span>
                    <div className="w-1 h-1 rounded-full bg-white"></div>
                    <span>{deployment.deployedTime}</span>
                    <div className="w-1 h-1 rounded-full bg-white"></div>
                    <span>{deployment.source}</span>
                  </div>
                </div>
                <div className="flex flex-row items-center gap-3">
                  <div className="text-right">
                    <p
                      className={`${deployment.statusColor} text-xs font-semibold`}
                    >
                      {deployment.status}
                    </p>
                    <p className="text-white text-xs">
                      {deployment.deployment}
                    </p>
                  </div>
                  <Triangle
                    size={15}
                    color="white"
                    className={`transition-transform ${expandedIndex === index ? "rotate-0" : "rotate-180"}`}
                  />
                </div>
              </div>
            </button>

            {expandedIndex === index && (
              <div className="mt-2 border border-[#9C9C9C]/50 bg-[#ffffff]/[0.02] rounded-md p-3 space-y-2">
                <h3 className="text-gray-400 text-xs font-semibold mb-3">
                  Version History
                </h3>
                {deployment.versions.map((v, vIndex) => (
                  <div
                    key={vIndex}
                    className="flex flex-row justify-between items-center p-2 hover:bg-[#ffffff]/5 rounded transition"
                  >
                    <div className="flex flex-col gap-1">
                      <p className="text-white text-sm font-mono">
                        {v.version}
                      </p>
                      <p className="text-gray-400 text-xs">
                        {v.status === "Success" ? (
                          <span className="text-green-500">{v.status}</span>
                        ) : (
                          <span className="text-red-500">{v.status}</span>
                        )}{" "}
                        • {v.time}
                      </p>
                    </div>
                    {v.version !== deployment.currentVersion && (
                      <button
                        onClick={() => handleRollback(index, v.version)}
                        className="flex items-center gap-1 px-3 py-1 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/50 text-orange-400 rounded text-xs transition"
                      >
                        <RotateCcw size={12} />
                        Rollback
                      </button>
                    )}
                    {v.version === deployment.currentVersion && (
                      <span className="text-green-500 text-xs font-semibold">
                        Current
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default RecentDeployment;
