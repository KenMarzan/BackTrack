import Nav from "./components/Nav";
import ContainerHealth from "./components/ContainerHealth";
import RecentDeployment from "./components/RecentDeployment";
import ActiveContainers from "./components/ActiveContainers";
import AnomalyDetection from "./components/AnomalyDetection";
import { RefreshCw } from "lucide-react";
export default function Home() {
  return (
    <div className="w-full h-screen flex flex-col bg-[#161C27] overflow-hidden">
      <Nav />

      <div className="p-8 flex-1 grid grid-rows-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-4 overflow-hidden min-h-0">
        <div className="flex flex-row justify-end gap-2">
          <div className=" flex flex-row  gap-2 w-40 border rounded-2xl border-[#5D5A5A] p-1 text-center text-white hover:bg-blue-200 justify-between items-center pr-4">
            <div className="flex flex-row gap-1 items-center  border-r-2 border-[#5D5A5A] pr-2 pl-2">
              <RefreshCw
                strokeWidth={2}
                absoluteStrokeWidth
                color="white"
                size={17}
              />
              <h1 className="text-shadow-md">Refresh</h1>
            </div>

            <div>
              <h1>10s</h1>
            </div>
          </div>
        </div>
        {/* Grid container below the navbar */}
        <div className="grid grid-cols-3 w-full gap-20 min-h-0 h-full">
          {/* 2/3 Column */}
          <ContainerHealth />

          {/* 1/3 Column */}

          <RecentDeployment />
        </div>

        {/* Bottom row - Anomaly Detection and Active Containers */}
        <div className="grid grid-cols-2 w-full gap-20 min-h-0 h-full">
          <AnomalyDetection />
          <ActiveContainers />
        </div>
      </div>
    </div>
  );
}
