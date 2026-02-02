import { TriangleAlert } from "lucide-react";
function AnomalyDetection() {
  return (
    <div className="border border-[#5D5A5A] rounded-2xl p-6 bg-[#F01010]/[0.02] h-full flex flex-col overflow-hidden">
      <div className="flex flex-row justify-between items-center mb-5 flex-shrink-0">
        <h1 className="text-white font-bold text-xl mb-4">Anomaly Detection</h1>
        <div className="flex flex-row gap-4">
          <div className="w-15 h-14 border border-[#FF0000] bg-[#DC0E0E]/10 text-center rounded-md">
            <h1 className="text-red-600 text-2xl font-bold">1</h1>
            <h1 className="text-xs text-white">Critical</h1>
          </div>
          <div className="w-15 h-14 border bg-[#EE9B00]/10 border-[#FF9D00] text-center rounded-md">
            <h1 className="text-[#FFA600] text-2xl font-bold">4</h1>
            <h1 className="text-xs text-white">High</h1>
          </div>
          <div className="w-15 h-14 border bg-[#E2D710]/10 border-[#CA9E0D] text-center rounded-md">
            <h1 className="text-[#FFDD00] text-2xl font-bold">2</h1>
            <h1 className="text-xs text-white">Warning</h1>
          </div>
        </div>
      </div>
      <div className="space-y-3 overflow-y-auto flex-1 min-h-0 scrollbar-hide">
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
          <div className="flex items-center justify-between">
            <div className="flex flex-row items-center gap-2 ">
              <div>
                <TriangleAlert size={15} color="red" />
              </div>
              <div>
                <div className="flex flex-row gap-2">
                  <p className="text-red-400 font-semibold">
                    checkpoint-service
                  </p>
                  <div className="bg-red-500 w-20 p-1 text-center rounded-md ">
                    <p className="text-white text-sm">CRITICAL</p>
                  </div>
                </div>
                <div>
                  <p className="text-gray-400 text-xs">
                    Unexpected spike in request latency
                  </p>
                </div>
              </div>
            </div>

            <span className="text-gray-400 text-xs">5 minutes ago</span>
          </div>
          <hr className="border-[#5D5A5A] my-2" />
          <div className="flex justify-between text-xs text-gray-400 mt-2">
            <span>
              Metric: <span className="text-red-400">Error Rate</span>
            </span>
            <span>
              Baseline: <span className="text-gray-300">0.1%</span>
            </span>
            <span>
              Current: <span className="text-red-400">15.8%</span>
            </span>
          </div>
        </div>

        <div className="bg-orange-500/10 border border-orange-500/30 rounded p-3">
          <div className="flex items-center justify-between">
            <div className="flex flex-row items-center gap-2 ">
              <div>
                <TriangleAlert size={15} color="orange" />
              </div>
              <div>
                <div className="flex flex-row gap-2">
                  <p className="text-orange-400 font-semibold">api-gateway</p>
                  <div className="bg-orange-500 w-20 p-1 text-center rounded-md">
                    <p className="text-white text-sm">WARNING</p>
                  </div>
                </div>
                <div>
                  <p className="text-gray-400 text-xs">
                    Memory usage exceeded threshold
                  </p>
                </div>
              </div>
            </div>
            <span className="text-gray-400 text-xs">2 minutes ago</span>
          </div>
          <hr className="border-[#5D5A5A] my-2" />
          <div className="flex justify-between text-xs text-gray-400 mt-2">
            <span>
              Metric: <span className="text-orange-400">Memory Usage</span>
            </span>
            <span>
              Baseline: <span className="text-gray-300">60%</span>
            </span>
            <span>
              Current: <span className="text-orange-400">85%</span>
            </span>
          </div>
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3">
          <div className="flex items-center justify-between">
            <div className="flex flex-row items-center gap-2 ">
              <div>
                <TriangleAlert size={15} color="#FFDD00" />
              </div>
              <div>
                <div className="flex flex-row gap-2">
                  <p className="text-yellow-400 font-semibold">api-gateway</p>
                  <div className="bg-yellow-500 w-20 p-1 text-center rounded-md">
                    <p className="text-white text-sm">WARNING</p>
                  </div>
                </div>
                <div>
                  <p className="text-gray-400 text-xs">
                    Memory usage exceeded threshold
                  </p>
                </div>
              </div>
            </div>
            <span className="text-gray-400 text-xs">2 minutes ago</span>
          </div>
          <hr className="border-[#5D5A5A] my-2" />
          <div className="flex justify-between text-xs text-gray-400 mt-2">
            <span>
              Metric: <span className="text-yellow-400">Response Time</span>
            </span>
            <span>
              Baseline: <span className="text-gray-300">200ms</span>
            </span>
            <span>
              Current: <span className="text-yellow-400">850ms</span>
            </span>
          </div>
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-3">
          <div className="flex items-center justify-between">
            <div className="flex flex-row items-center gap-2 ">
              <div>
                <TriangleAlert size={15} color="#FFDD00" />
              </div>
              <div>
                <div className="flex flex-row gap-2">
                  <p className="text-yellow-400 font-semibold">cache-service</p>
                  <div className="bg-yellow-500 w-20 p-1 text-center rounded-md">
                    <p className="text-white text-sm">WARNING</p>
                  </div>
                </div>
                <div>
                  <p className="text-gray-400 text-xs">
                    Cache hit rate degradation detected
                  </p>
                </div>
              </div>
            </div>
            <span className="text-gray-400 text-xs">1 minute ago</span>
          </div>
          <hr className="border-[#5D5A5A] my-2" />
          <div className="flex justify-between text-xs text-gray-400 mt-2">
            <span>
              Metric: <span className="text-yellow-400">Cache Hit Rate</span>
            </span>
            <span>
              Baseline: <span className="text-gray-300">92%</span>
            </span>
            <span>
              Current: <span className="text-yellow-400">72%</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnomalyDetection;
