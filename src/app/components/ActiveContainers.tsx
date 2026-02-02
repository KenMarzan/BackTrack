import { RefreshCw } from "lucide-react";
import { Container } from "lucide-react";
function ActiveContainers() {
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
              <tr className="border-b border-[#9C9C9C]/50">
                <td className="text-gray-300 p-3 font-mono text-sm">
                  a1b2c3d4e5f6
                </td>
                <td className="text-white p-3">api-gateway</td>
                <td className="text-gray-300 p-3">node:18-alpine</td>
                <td className="text-green-500 p-3">Running</td>
                <td className="text-gray-300 p-3">2 hours ago</td>
                <td className="text-gray-300 p-3">3000:3000</td>
              </tr>
              <tr className="border-b border-[#9C9C9C]/50">
                <td className="text-gray-300 p-3 font-mono text-sm">
                  f6e5d4c3b2a1
                </td>
                <td className="text-white p-3">database</td>
                <td className="text-gray-300 p-3">postgres:14</td>
                <td className="text-green-500 p-3">Running</td>
                <td className="text-gray-300 p-3">5 hours ago</td>
                <td className="text-gray-300 p-3">5432:5432</td>
              </tr>
              <tr className="border-b border-[#9C9C9C]/50">
                <td className="text-gray-300 p-3 font-mono text-sm">
                  9g8h7i6j5k4l
                </td>
                <td className="text-white p-3">redis-cache</td>
                <td className="text-gray-300 p-3">redis:7-alpine</td>
                <td className="text-green-500 p-3">Running</td>
                <td className="text-gray-300 p-3">1 day ago</td>
                <td className="text-gray-300 p-3">6379:6379</td>
              </tr>
              <tr className="border-b border-[#9C9C9C]/50">
                <td className="text-gray-300 p-3 font-mono text-sm">
                  9g8h7i6j5k4l
                </td>
                <td className="text-white p-3">redis-cache</td>
                <td className="text-gray-300 p-3">redis:7-alpine</td>
                <td className="text-green-500 p-3">Running</td>
                <td className="text-gray-300 p-3">1 day ago</td>
                <td className="text-gray-300 p-3">6379:6379</td>
              </tr>
              <tr className="border-b border-[#9C9C9C]/50">
                <td className="text-gray-300 p-3 font-mono text-sm">
                  9g8h7i6j5k4l
                </td>
                <td className="text-white p-3">redis-cache</td>
                <td className="text-gray-300 p-3">redis:7-alpine</td>
                <td className="text-green-500 p-3">Running</td>
                <td className="text-gray-300 p-3">1 day ago</td>
                <td className="text-gray-300 p-3">6379:6379</td>
              </tr>
              <tr className="border-b border-[#9C9C9C]/50">
                <td className="text-gray-300 p-3 font-mono text-sm">
                  9g8h7i6j5k4l
                </td>
                <td className="text-white p-3">redis-cache</td>
                <td className="text-gray-300 p-3">redis:7-alpine</td>
                <td className="text-green-500 p-3">Running</td>
                <td className="text-gray-300 p-3">1 day ago</td>
                <td className="text-gray-300 p-3">6379:6379</td>
              </tr>
              <tr className="border-b border-[#9C9C9C]/50">
                <td className="text-gray-300 p-3 font-mono text-sm">
                  9g8h7i6j5k4l
                </td>
                <td className="text-white p-3">redis-cache</td>
                <td className="text-gray-300 p-3">redis:7-alpine</td>
                <td className="text-green-500 p-3">Running</td>
                <td className="text-gray-300 p-3">1 day ago</td>
                <td className="text-gray-300 p-3">6379:6379</td>
              </tr>
              <tr className="border-b border-[#9C9C9C]/50">
                <td className="text-gray-300 p-3 font-mono text-sm">
                  9g8h7i6j5k4l
                </td>
                <td className="text-white p-3">redis-cache</td>
                <td className="text-gray-300 p-3">redis:7-alpine</td>
                <td className="text-green-500 p-3">Running</td>
                <td className="text-gray-300 p-3">1 day ago</td>
                <td className="text-gray-300 p-3">6379:6379</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default ActiveContainers;
