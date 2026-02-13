"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Container } from "lucide-react";

interface ContainerInfo {
  id: string;
  timestamp: string;
  namespace: string;
  podName: string;
  containerName: string;
  imageTag: string;
  nodeName: string;
  status: string;
}

function ActiveContainers() {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchContainers = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/container-health");
        const data = await response.json();

        // Filter out specific services that should not be displayed
        const excludedServices = [
          "recommendationservice",
          "cartservice",
          "shippingservice",
          "unknown",
        ];

        // Transform metrics data into container info format
        const containerList: ContainerInfo[] = Array.isArray(data)
          ? data
              .filter(
                (item: any) =>
                  !excludedServices.includes(item.container?.toLowerCase()),
              )
              .map((item: any, index: number) => ({
                id: `${item.container.substring(0, 12)}`,
                timestamp: new Date().toLocaleString(),
                namespace: item.namespace || "default",
                podName: item.pod || item.container,
                containerName: item.container,
                imageTag: `${item.container}:latest`,
                nodeName: "node-01",
                status: "Running",
              }))
          : [];

        setContainers(containerList);
      } catch (error) {
        console.error("Failed to fetch containers:", error);
        setContainers([]);
      } finally {
        setLoading(false);
      }
    };

    fetchContainers();
    const interval = setInterval(fetchContainers, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-row gap-2 items-center mb-4"></div>
      <div className="border border-[#5D5A5A] rounded-2xl p-6 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex flex-row items-center gap-2 flex-shrink-0">
          <Container color="white" />
          <h1 className="text-white font-semibold">ACTIVE CONTAINERS</h1>
        </div>
        <div className="overflow-y-auto overflow-x-auto flex-1 min-h-0 scrollbar-hide mt-4">
          {loading ? (
            <div className="text-gray-400 text-center py-6">
              Loading containers...
            </div>
          ) : containers.length === 0 ? (
            <div className="text-gray-400 text-center py-6">
              No containers found.
            </div>
          ) : (
            <table className="w-full text-left table-fixed">
              <thead>
                <tr className="border-b border-[#9C9C9C]">
                  <th className="text-white font-semibold p-2 text-xs w-24">
                    ID
                  </th>
                  <th className="text-white font-semibold p-2 text-xs w-36">
                    Timestamp
                  </th>
                  <th className="text-white font-semibold p-2 text-xs w-24">
                    Namespace
                  </th>
                  <th className="text-white font-semibold p-2 text-xs w-32">
                    Pod Name
                  </th>
                  <th className="text-white font-semibold p-2 text-xs w-32">
                    Container
                  </th>
                  <th className="text-white font-semibold p-2 text-xs w-36">
                    Image Tag
                  </th>
                  <th className="text-white font-semibold p-2 text-xs w-24">
                    Node
                  </th>
                  <th className="text-white font-semibold p-2 text-xs w-20">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {containers.map((container, index) => (
                  <tr key={index} className="border-b border-[#9C9C9C]/50">
                    <td className="text-gray-300 p-2 font-mono text-xs truncate">
                      {container.id}
                    </td>
                    <td className="text-gray-300 p-2 text-xs truncate">
                      {container.timestamp}
                    </td>
                    <td className="text-white p-2 text-xs truncate">
                      {container.namespace}
                    </td>
                    <td className="text-gray-300 p-2 text-xs truncate">
                      {container.podName}
                    </td>
                    <td className="text-white p-2 text-xs truncate">
                      {container.containerName}
                    </td>
                    <td className="text-gray-300 p-2 text-xs truncate">
                      {container.imageTag}
                    </td>
                    <td className="text-gray-300 p-2 text-xs truncate">
                      {container.nodeName}
                    </td>
                    <td className="text-green-500 p-2 text-xs">
                      {container.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default ActiveContainers;
