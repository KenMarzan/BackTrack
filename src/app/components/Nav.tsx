"use client";
import { X, Check, AlertCircle, Loader } from "lucide-react";
import { RefreshCw } from "lucide-react";
import React from "react";
import { useState, useEffect } from "react";

function Nav() {
  const [currentTime, setCurrentTime] = useState<string>("");
  const [clusterName, setClusterName] = useState("");
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [namespace, setNamespace] = useState("");
  const [token, setToken] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [testMessage, setTestMessage] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const currentDate = new Date();
  const formattedDate = currentDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const timeString = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
      setCurrentTime(timeString);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleTestConnection = async () => {
    if (!apiEndpoint || !token || !namespace) {
      setTestStatus("error");
      setTestMessage("Please fill in all required fields");
      return;
    }

    setIsTesting(true);
    setTestStatus("idle");
    setTestMessage("");

    try {
      const response = await fetch("/api/test-k8s-connection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiEndpoint,
          namespace,
          token,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setTestStatus("success");
        setTestMessage(
          `Successfully connected! Found ${data.podCount} pods in ${namespace} namespace`,
        );
      } else {
        setTestStatus("error");
        setTestMessage(data.error || "Connection failed");
      }
    } catch (error) {
      setTestStatus("error");
      setTestMessage(
        error instanceof Error ? error.message : "Connection test failed",
      );
    } finally {
      setIsTesting(false);
    }
  };

  const handleConnect = async () => {
    if (!apiEndpoint || !token || !namespace) {
      setTestStatus("error");
      setTestMessage("Please fill in all required fields");
      return;
    }

    setIsConnecting(true);

    try {
      const response = await fetch("/api/connect-k8s", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clusterName,
          apiEndpoint,
          namespace,
          token,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setIsConnected(true);
        setTestStatus("success");
        setTestMessage(
          "Connected successfully! You can now close this dialog.",
        );
        setTimeout(() => {
          setIsOpen(false);
          setIsConnected(false);
        }, 2000);
      } else {
        setTestStatus("error");
        setTestMessage(data.error || "Connection failed");
      }
    } catch (error) {
      setTestStatus("error");
      setTestMessage(
        error instanceof Error ? error.message : "Connection failed",
      );
    } finally {
      setIsConnecting(false);
    }
  };
  return (
    <>
      <div className="w-full h-15 bg-[#FFFFFF]/[0.04] flex flex-row justify-between items-center p-10 rounded-bl-2xl rounded-br-2xl">
        <h1 className="text-white">
          <b>BackTrack </b>
        </h1>

        <div className="flex flex-row gap-2 items-center">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="w-40 flex flex-row justify-center items-center gap-1 p-1 border border-[#5D5A5A] rounded-2xl hover:bg-white/5 transition"
          >
            <RefreshCw
              strokeWidth={2}
              absoluteStrokeWidth
              color="white"
              size={20}
            />
            <span className="text-white text-xs">Configure Cluster</span>
          </button>
          <div className="w-2 h-2  rounded-full bg-green-500"></div>
          <p className="text-white text-xs">
            Cluster: production-us-east | {formattedDate} | {currentTime}
          </p>
        </div>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[720px] max-w-[92vw] max-h-[92vh] overflow-y-auto rounded-2xl border border-[#5D5A5A] bg-[#1E2A44] p-6 shadow-xl scrollbar-hide">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-md bg-blue-600/20 flex items-center justify-center">
                  <div className="h-4 w-5 rounded-sm border border-blue-400" />
                </div>
                <div>
                  <h2 className="text-white text-lg font-semibold">
                    Connect to Kubernetes Cluster
                  </h2>
                  <p className="text-xs text-gray-300">
                    Configure your connection string
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-gray-300 hover:text-white"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <label className="text-xs text-gray-300">Cluster Name</label>
                <input
                  type="text"
                  value={clusterName}
                  onChange={(e) => setClusterName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[#38445E] bg-[#22314F] px-3 py-2 text-sm text-white focus:outline-none"
                  placeholder="A friendly name for your cluster"
                />
              </div>

              <div>
                <label className="text-xs text-gray-300">
                  API Server Endpoint
                </label>
                <input
                  type="text"
                  value={apiEndpoint}
                  onChange={(e) => setApiEndpoint(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[#38445E] bg-[#22314F] px-3 py-2 text-sm text-white focus:outline-none"
                  placeholder="https://your-kubernetes-api:6443"
                />
              </div>

              <div>
                <label className="text-xs text-gray-300">
                  Default Namespace
                </label>
                <input
                  type="text"
                  value={namespace}
                  onChange={(e) => setNamespace(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[#38445E] bg-[#22314F] px-3 py-2 text-sm text-white focus:outline-none"
                  placeholder="default"
                />
              </div>

              <div>
                <label className="text-xs text-gray-300">
                  Service Account Token
                </label>
                <div className="mt-1 relative">
                  <input
                    type={showToken ? "text" : "password"}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="w-full rounded-md border border-[#38445E] bg-[#22314F] px-3 py-2 pr-10 text-sm text-white focus:outline-none"
                    placeholder="Bearer token for authentication"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition"
                  >
                    {showToken ? (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-4.803m5.596-3.856a3.375 3.375 0 11-4.753 4.753m7.228-7.228l2.828 2.829m-9.914-9.914L3.172 3.172m9.914 9.914L21 21"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {testStatus !== "idle" && (
                <div
                  className={`rounded-md border p-3 flex items-start gap-2 ${
                    testStatus === "success"
                      ? "border-green-500/30 bg-green-500/10"
                      : "border-red-500/30 bg-red-500/10"
                  }`}
                >
                  {testStatus === "success" ? (
                    <Check
                      size={16}
                      className="text-green-400 flex-shrink-0 mt-0.5"
                    />
                  ) : (
                    <AlertCircle
                      size={16}
                      className="text-red-400 flex-shrink-0 mt-0.5"
                    />
                  )}
                  <p
                    className={`text-sm ${
                      testStatus === "success"
                        ? "text-green-300"
                        : "text-red-300"
                    }`}
                  >
                    {testMessage}
                  </p>
                </div>
              )}

              <div className="rounded-md border border-[#38445E] bg-[#22314F] p-4">
                <h3 className="text-sm text-white font-semibold">
                  How to get your credentials
                </h3>
                <ol className="mt-3 space-y-3 text-xs text-gray-300 list-decimal list-inside">
                  <li>
                    Get your cluster API endpoint:
                    <div className="mt-2 rounded-md bg-[#1A243B] px-3 py-2 font-mono text-[11px] overflow-x-auto">
                      kubectl cluster-info
                    </div>
                  </li>
                  <li>
                    Get your service account token (choose one for your OS):
                    <div className="mt-2 space-y-2">
                      <div>
                        <p className="text-gray-400 mb-1">Linux/Mac:</p>
                        <div className="rounded-md bg-[#1A243B] px-3 py-2 font-mono text-[11px] overflow-x-auto">
                          {`kubectl get secret $(kubectl get sa default -o jsonpath='{.secrets[0].name}') -o jsonpath='{.data.token}' | base64 --decode`}
                        </div>
                      </div>
                      <div>
                        <p className="text-gray-400 mb-1">
                          Windows PowerShell:
                        </p>
                        <div className="rounded-md bg-[#1A243B] px-3 py-2 font-mono text-[11px] overflow-x-auto">
                          {`$secret = kubectl get sa default -o jsonpath='{.secrets[0].name}'; kubectl get secret $secret -o jsonpath='{.data.token}' | ForEach-Object { [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($_)) }`}
                        </div>
                      </div>
                    </div>
                  </li>
                </ol>
              </div>
            </div>

            <div className="mt-6 flex justify-between">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setTestStatus("idle");
                  setTestMessage("");
                }}
                className="px-4 py-2 rounded-md bg-[#2B3A58] text-gray-200 hover:bg-[#334564] transition"
              >
                Cancel
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTesting || isConnecting}
                  className="px-4 py-2 rounded-md bg-[#2B3A58] text-gray-200 hover:bg-[#334564] transition disabled:opacity-50 flex items-center gap-2"
                >
                  {isTesting ? (
                    <>
                      <Loader size={16} className="animate-spin" />
                      Testing...
                    </>
                  ) : (
                    "Test Connection"
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={isConnecting || isTesting}
                  className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-500 transition disabled:opacity-50 flex items-center gap-2"
                >
                  {isConnecting ? (
                    <>
                      <Loader size={16} className="animate-spin" />
                      Connecting...
                    </>
                  ) : isConnected ? (
                    <>
                      <Check size={16} />
                      Connected
                    </>
                  ) : (
                    "Connect"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Nav;
