import { Container } from "lucide-react";
import type { DashboardService } from "@/lib/monitoring-types";

function ActiveContainers({ services }: { services: DashboardService[] }) {
  const statusClassName = (status: DashboardService["status"]) => {
    if (status === "running") return "text-green-500 p-3";
    if (status === "down") return "text-red-500 p-3";
    return "text-yellow-400 p-3";
  };

  const statusLabel = (status: DashboardService["status"]) => {
    if (status === "running") return "Running";
    if (status === "down") return "Down";
    return "Unknown";
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-row gap-2 items-center mb-4"></div>
      <div className="border border-[#5D5A5A] rounded-2xl p-6 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex flex-row items-center gap-2 flex-shrink-0">
          <Container color="white" />
          <h1 className="text-white font-semibold">ACTIVE CONTAINERS</h1>
        </div>
        <div className="overflow-y-auto overflow-x-auto flex-1 min-h-0 scrollbar-hide">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#9C9C9C]">
                <th className="text-white font-semibold p-3">Container ID</th>
                <th className="text-white font-semibold p-3">Name</th>
                <th className="text-white font-semibold p-3">Image</th>
                <th className="text-white font-semibold p-3">Status</th>
                <th className="text-white font-semibold p-3">Created</th>
                <th className="text-white font-semibold p-3">Ports</th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0 ? (
                <tr>
                  <td className="text-gray-400 p-3" colSpan={6}>
                    No discovered services yet. Connect an app from Configure Cluster.
                  </td>
                </tr>
              ) : (
                services.map((service) => (
                  <tr className="border-b border-[#9C9C9C]/50" key={service.id}>
                    <td className="text-gray-300 p-3 font-mono text-sm">
                      {service.id.slice(0, 12)}
                    </td>
                    <td className="text-white p-3">{service.name}</td>
                    <td className="text-gray-300 p-3">{service.platform}</td>
                    <td className={statusClassName(service.status)}>
                      {statusLabel(service.status)}
                    </td>
                    <td className="text-gray-300 p-3">{service.namespace}</td>
                    <td className="text-gray-300 p-3">{service.ports.join(", ") || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default ActiveContainers;
