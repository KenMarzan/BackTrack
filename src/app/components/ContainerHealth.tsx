import React from "react";
import LineChart from "./LineChart";

type DashboardService = {
  id: string;
  status: "running" | "down" | "unknown";
  cpuCores: number;
  memoryMiB: number;
  requestRate: number;
};

function ContainerHealth({ services }: { services: DashboardService[] }) {
  const totalCpu = services.reduce((sum, service) => sum + service.cpuCores, 0);
  const totalMemory = services.reduce((sum, service) => sum + service.memoryMiB, 0);
  const totalRate = services.reduce((sum, service) => sum + service.requestRate, 0);
  const running = services.filter((service) => service.status === "running").length;

  return (
    <div className="col-span-2 p-6 border border-[#5D5A5A] rounded-2xl h-full flex flex-col overflow-hidden">
      <h1 className="font-bold text-2xl text-white flex-shrink-0">
        Container Health
      </h1>

      <div className="flex flex-row gap-2 mt-1 flex-shrink-0">
        <div className="w-30 border rounded-xl border-white p-1 text-center text-white hover:bg-blue-200 flex flex-row justify-center gap-1 ">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="white"
            className="size-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
            />
          </svg>
          <p className="text-md">CPU</p>
        </div>
        <div className="w-30 border rounded-xl border-white p-1 text-center text-white hover:bg-blue-200 flex flex-row justify-center gap-1 ">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="white"
            className="size-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
            />
          </svg>
          <p className="text-md">CPU</p>
        </div>
        <div className="w-30 border rounded-xl border-white p-1 text-center text-white hover:bg-blue-200 flex flex-row justify-center gap-1 ">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="white"
            className="size-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
            />
          </svg>
          <p className="text-md">CPU</p>
        </div>
        <div className="w-30 border rounded-xl border-white p-1 text-center text-white hover:bg-blue-200 flex flex-row justify-center gap-1 ">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="white"
            className="size-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Zm.75-12h9v9h-9v-9Z"
            />
          </svg>
          <p className="text-md">CPU</p>
        </div>
      </div>
      <div className="mt-4 flex-1 min-h-0">
        <LineChart services={services} />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-white">
        <div className="border border-[#5D5A5A] rounded-md p-2 text-center">
          CPU {totalCpu.toFixed(3)}
        </div>
        <div className="border border-[#5D5A5A] rounded-md p-2 text-center">
          MEM {totalMemory.toFixed(1)} MiB
        </div>
        <div className="border border-[#5D5A5A] rounded-md p-2 text-center">
          REQ {totalRate.toFixed(2)}
        </div>
        <div className="border border-[#5D5A5A] rounded-md p-2 text-center">
          UP {running}/{services.length}
        </div>
      </div>
    </div>
  );
}

export default ContainerHealth;
