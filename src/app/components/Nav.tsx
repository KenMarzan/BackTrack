"use client";
import { X } from "lucide-react";
import { RefreshCw } from "lucide-react";
import React from "react";
import { useState } from "react";

type ConnectionForm = {
  appName: string;
  platform: "kubernetes" | "docker";
  architecture: "monolith" | "microservices";
  clusterName: string;
  apiServerEndpoint: string;
  namespace: string;
  prometheusUrl: string;
  authToken: string;
};

function Nav() {
  const currentDate = new Date();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [discoveredCount, setDiscoveredCount] = useState<number | null>(null);
  const [form, setForm] = useState<ConnectionForm>({
    appName: "",
    platform: "kubernetes",
    architecture: "microservices",
    clusterName: "",
    apiServerEndpoint: "",
    namespace: "default",
    prometheusUrl: "http://localhost:9090",
    authToken: "",
  });

  const formattedDate = currentDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const updateField = (field: keyof ConnectionForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submitConnection = async (action: "test" | "connect") => {
    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...form }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Connection request failed.");
      }

      setDiscoveredCount(Array.isArray(payload.discoveredServices) ? payload.discoveredServices.length : 0);
      setStatusMessage(payload.message || "Connection completed.");

      if (action === "connect") {
        window.dispatchEvent(new Event("backtrack:connection-updated"));
      }
    } catch (error: any) {
      setStatusMessage(error.message);
    } finally {
      setIsSubmitting(false);
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
            Cluster: production-us-east Last updated: {formattedDate}
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
                <label className="text-xs text-gray-300">Application Name</label>
                <input
                  type="text"
                  value={form.appName}
                  onChange={(event) => updateField("appName", event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#38445E] bg-[#22314F] px-3 py-2 text-sm text-white focus:outline-none"
                  placeholder="checkoutservice"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-300">Platform</label>
                  <select
                    value={form.platform}
                    onChange={(event) => updateField("platform", event.target.value)}
                    className="mt-1 w-full rounded-md border border-[#38445E] bg-[#22314F] px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    <option value="kubernetes">Kubernetes</option>
                    <option value="docker">Docker</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-300">Architecture</label>
                  <select
                    value={form.architecture}
                    onChange={(event) => updateField("architecture", event.target.value)}
                    className="mt-1 w-full rounded-md border border-[#38445E] bg-[#22314F] px-3 py-2 text-sm text-white focus:outline-none"
                  >
                    <option value="microservices">Microservices (discover all services)</option>
                    <option value="monolith">Monolith (focused discovery)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-300">Cluster Name</label>
                <input
                  type="text"
                  value={form.clusterName}
                  onChange={(event) => updateField("clusterName", event.target.value)}
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
                  value={form.apiServerEndpoint}
                  onChange={(event) => updateField("apiServerEndpoint", event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#38445E] bg-[#22314F] px-3 py-2 text-sm text-white focus:outline-none"
                  placeholder="The URL of your Kubernetes cluster"
                />
              </div>

              <div>
                <label className="text-xs text-gray-300">Prometheus URL</label>
                <input
                  type="text"
                  value={form.prometheusUrl}
                  onChange={(event) => updateField("prometheusUrl", event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#38445E] bg-[#22314F] px-3 py-2 text-sm text-white focus:outline-none"
                  placeholder="http://localhost:9090"
                />
              </div>

              <div>
                <label className="text-xs text-gray-300">
                  Default Namespace
                </label>
                <input
                  type="text"
                  value={form.namespace}
                  onChange={(event) => updateField("namespace", event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#38445E] bg-[#22314F] px-3 py-2 text-sm text-white focus:outline-none"
                  placeholder="Kubernetes namespace to monitor"
                />
              </div>

              <div>
                <label className="text-xs text-gray-300">
                  Service Account Token
                </label>
                <input
                  type="text"
                  value={form.authToken}
                  onChange={(event) => updateField("authToken", event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#38445E] bg-[#22314F] px-3 py-2 text-sm text-white focus:outline-none"
                  placeholder="Bearer token for authentication. Get this from your cluster service account."
                />
              </div>

              {statusMessage ? (
                <div className="rounded-md border border-[#38445E] bg-[#22314F] p-3">
                  <p className="text-xs text-gray-200">{statusMessage}</p>
                  {discoveredCount !== null ? (
                    <p className="text-xs text-green-400 mt-1">
                      Discovered services: {discoveredCount}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-md border border-[#38445E] bg-[#22314F] p-4">
                <h3 className="text-sm text-white font-semibold">
                  How to get your credentials
                </h3>
                <ol className="mt-3 space-y-3 text-xs text-gray-300 list-decimal list-inside">
                  <li>
                    Get your cluster API endpoint:
                    <div className="mt-2 rounded-md bg-[#1A243B] px-3 py-2 font-mono text-[11px]">
                      kubectl cluster-info
                    </div>
                  </li>
                  <li>
                    Get your service account token:
                    <div className="mt-2 rounded-md bg-[#1A243B] px-3 py-2 font-mono text-[11px]">
                      {`  kubectl get secret $(kubectl get sa default -o jsonpath="{.secrets[0].name}" -o jsonpath="{.secrets[0].name}") -o jsonpath="{.data.token}" | base64 --decode`}
                    </div>
                  </li>
                </ol>
              </div>
            </div>

            <div className="mt-6 flex justify-between">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 rounded-md bg-[#2B3A58] text-gray-200 hover:bg-[#334564]"
              >
                Cancel
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => submitConnection("test")}
                  className="px-4 py-2 rounded-md bg-[#2B3A58] text-gray-200 hover:bg-[#334564]"
                >
                  {isSubmitting ? "Testing..." : "Test Connection"}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => submitConnection("connect")}
                  className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-500"
                >
                  {isSubmitting ? "Connecting..." : "Connect"}
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
