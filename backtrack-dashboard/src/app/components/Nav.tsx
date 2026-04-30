"use client";
import { Boxes, CircuitBoard, Cloud, Info, Plug, Settings2, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";
import CustomSelect from "./CustomSelect";

type ConnectionForm = {
  appName: string;
  platform: "kubernetes" | "docker";
  architecture: "monolith" | "microservices";
  clusterName: string;
  apiServerEndpoint: string;
  namespace: string;
  prometheusUrl: string;
  authToken: string;
  githubRepo: string;
  githubBranch: string;
  githubToken: string;
};

type NavProps = {
  healthSummary?: { total: number; up: number; down: number };
};

function Nav({ healthSummary }: NavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [discoveredCount, setDiscoveredCount] = useState<number | null>(null);
  const [lastAction, setLastAction] = useState<"test" | "connect" | null>(null);

  useEffect(() => {
    const open = () => setIsOpen(true);
    window.addEventListener("backtrack:open-configure", open);
    return () => window.removeEventListener("backtrack:open-configure", open);
  }, []);
  const [form, setForm] = useState<ConnectionForm>({
    appName: "",
    platform: "kubernetes",
    architecture: "microservices",
    clusterName: "",
    apiServerEndpoint: "",
    namespace: "default",
    prometheusUrl: "http://localhost:9090",
    authToken: "",
    githubRepo: "",
    githubBranch: "main",
    githubToken: "",
  });

  const formattedDate = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    [],
  );

  const updateField = (field: keyof ConnectionForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submitConnection = async (action: "test" | "connect") => {
    setIsSubmitting(true);
    setStatusMessage(null);
    setLastAction(action);

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

      setDiscoveredCount(
        Array.isArray(payload.discoveredServices) ? payload.discoveredServices.length : 0,
      );
      setStatusMessage(payload.message || "Connection completed.");

      if (action === "connect") {
        // Send all discovered service names so agent creates per-service collectors
        const discoveredNames: string[] = Array.isArray(payload.discoveredServices)
          ? payload.discoveredServices.map((s: { name: string }) => s.name).filter(Boolean)
          : [];

        // Live-reconfigure agent without restart
        fetch("/api/agent?path=reconfigure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target: form.appName,
            mode: form.platform,
            namespace: form.namespace,
            services: discoveredNames,
          }),
        }).catch(() => {/* agent unavailable — non-fatal */});

        // Also write backtrack-agent/.env so next startup picks up the same values
        fetch("/api/agent/env", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            platform: form.platform,
            appName: form.appName,
            namespace: form.namespace,
          }),
        }).catch(() => {/* non-fatal */});

        window.dispatchEvent(new Event("backtrack:connection-updated"));
      }
    } catch (error: any) {
      setStatusMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDocker = form.platform === "docker";

  const pathname = usePathname();
  const total = healthSummary?.total ?? 0;
  const up = healthSummary?.up ?? 0;
  const down = healthSummary?.down ?? 0;
  const clusterHealthy = total === 0 ? true : down === 0;

  return (
    <>
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-[rgba(7,9,13,0.65)] border-b border-[var(--border-soft)]">
        <div className="px-4 sm:px-6 lg:px-8 xl:px-10 py-3.5 flex items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative h-9 w-9 rounded-xl border border-[var(--border-mid)] bg-gradient-to-br from-[rgba(94,234,212,0.12)] to-[rgba(167,139,250,0.10)] flex items-center justify-center">
              <CircuitBoard size={16} className="text-[var(--accent-teal)]" />
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[var(--accent-teal)] shadow-[0_0_10px_rgba(94,234,212,0.65)]" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="bt-display text-[20px] leading-none text-white">
                  Back<span className="italic text-[var(--accent-teal)]">Track</span>
                </h1>
                <span className="hidden sm:inline-flex bt-chip bt-chip-teal">v0.1</span>
              </div>
              <p className="hidden sm:block text-[10.5px] uppercase tracking-[0.24em] text-[var(--text-muted)] mt-1">
                Telemetry · Self-Healing · Rollback
              </p>
            </div>
          </div>

          {/* Screen navigation */}
          <nav className="hidden md:flex items-center gap-1">
            {([
              { href: "/", label: "Dashboard" },
              { href: "/anomalies", label: "Anomalies" },
              { href: "/metrics", label: "Metrics" },
              { href: "/evaluate", label: "Evaluate" },
            ] as const).map(({ href, label }) => {
              const isActive =
                href === "/"
                  ? pathname === "/"
                  : pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className="px-3 py-[5px] rounded-lg border text-[12px] transition-all duration-150"
                  style={{
                    borderColor: isActive ? "rgba(94,234,212,0.35)" : "transparent",
                    background: isActive ? "rgba(94,234,212,0.07)" : "transparent",
                    color: isActive ? "#d7f7ee" : "var(--text-secondary)",
                  }}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* Status cluster */}
          <div className="flex items-center gap-2">
            <div className="hidden md:flex items-center gap-2.5 rounded-full border border-[var(--border-soft)] bg-white/[0.02] px-3 py-1.5">
              <span className={`bt-pulse-dot ${clusterHealthy ? "" : "bt-red"}`} />
              <span className="text-[11px] text-[var(--text-secondary)]">
                {clusterHealthy ? "Cluster nominal" : "Degraded cluster"}
              </span>
              <span className="h-3 w-px bg-[var(--border-mid)]" />
              <span className="bt-mono text-[11px] text-[var(--text-primary)]">
                {up}/{total || "—"} up
              </span>
            </div>
            <div className="hidden lg:flex items-center gap-2 rounded-full border border-[var(--border-soft)] bg-white/[0.02] px-3 py-1.5 text-[11px] text-[var(--text-secondary)]">
              <Cloud size={12} className="text-[var(--accent-violet)]" />
              <span>{formattedDate}</span>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="group inline-flex items-center gap-2 rounded-full border border-[rgba(94,234,212,0.35)] bg-[rgba(94,234,212,0.06)] px-3.5 py-1.5 text-[12px] text-[#c6f5e8] hover:bg-[rgba(94,234,212,0.12)] transition"
            >
              <Plug size={13} className="text-[var(--accent-teal)]" />
              <span>Configure Cluster</span>
              <span className="bt-kbd hidden sm:inline">⌘K</span>
            </button>
          </div>
        </div>
      </header>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-6">
          <div className="relative w-full max-w-[760px] max-h-[92vh] overflow-y-auto rounded-2xl border border-[var(--border-mid)] bg-[#0b1018] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)] scrollbar-hide">
            {/* Decorative header band */}
            <div className="relative h-20 bt-grid border-b border-[var(--border-soft)] overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-[rgba(94,234,212,0.10)] via-transparent to-[rgba(167,139,250,0.12)]" />
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="absolute top-3 right-3 h-8 w-8 rounded-full border border-[var(--border-soft)] bg-white/[0.03] hover:bg-white/[0.06] flex items-center justify-center text-[var(--text-secondary)]"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-6 sm:px-8 -mt-10 relative">
              <div className="flex items-start gap-4">
                <div className="h-14 w-14 rounded-2xl border border-[var(--border-mid)] bg-[#0f1621] flex items-center justify-center">
                  <Settings2 size={22} className="text-[var(--accent-teal)]" />
                </div>
                <div className="pt-1.5">
                  <h2 className="bt-display text-[26px] leading-tight text-white">
                    Connect a <span className="italic text-[var(--accent-teal)]">cluster</span>
                  </h2>
                  <p className="text-xs text-[var(--text-secondary)] mt-1">
                    {isDocker
                      ? "Enter your Docker container name — BackTrack will start monitoring it immediately."
                      : "Point BackTrack at your Kubernetes cluster to discover services, stream metrics, and enable one-click rollback."}
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-4 pb-6">
                <Field
                  label="Application name"
                  hint={isDocker ? "Docker container name to monitor (e.g. my-app)." : "Logical group for the discovered services (e.g. checkoutservice)."}
                >
                  <input
                    type="text"
                    value={form.appName}
                    onChange={(e) => updateField("appName", e.target.value)}
                    className="bt-input"
                    placeholder={isDocker ? "my-app" : "checkoutservice"}
                  />
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Platform" hint="Runtime BackTrack will query.">
                    <CustomSelect
                      value={form.platform}
                      onChange={(v) => updateField("platform", v)}
                      options={[
                        { value: "kubernetes", label: "Kubernetes" },
                        { value: "docker", label: "Docker" },
                      ]}
                    />
                  </Field>
                  <Field label="Architecture" hint="Controls discovery breadth.">
                    <CustomSelect
                      value={form.architecture}
                      onChange={(v) => updateField("architecture", v)}
                      options={[
                        { value: "microservices", label: "Microservices — discover all" },
                        { value: "monolith", label: "Monolith — focused discovery" },
                      ]}
                    />
                  </Field>
                </div>

                {!isDocker && (
                  <Field label="Cluster name" hint="Friendly label shown across the dashboard.">
                    <input
                      type="text"
                      value={form.clusterName}
                      onChange={(e) => updateField("clusterName", e.target.value)}
                      className="bt-input"
                      placeholder="production-us-east"
                    />
                  </Field>
                )}

                {!isDocker && (
                  <Field label="API server endpoint" hint="HTTPS URL of the kube-apiserver.">
                    <input
                      type="text"
                      value={form.apiServerEndpoint}
                      onChange={(e) => updateField("apiServerEndpoint", e.target.value)}
                      className="bt-input"
                      placeholder="https://kubernetes.default.svc"
                    />
                  </Field>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Prometheus URL (optional)" hint="PromQL endpoint. Leave blank to use Docker stats fallback.">
                    <input
                      type="text"
                      value={form.prometheusUrl}
                      onChange={(e) => updateField("prometheusUrl", e.target.value)}
                      className="bt-input"
                      placeholder="http://localhost:9090"
                    />
                  </Field>
                  {!isDocker && (
                    <Field label="Namespace" hint="Primary namespace to watch.">
                      <input
                        type="text"
                        value={form.namespace}
                        onChange={(e) => updateField("namespace", e.target.value)}
                        className="bt-input"
                        placeholder="default"
                      />
                    </Field>
                  )}
                </div>


                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="GitHub repository" hint="Used for commit-aware rollbacks.">
                    <input
                      type="text"
                      value={form.githubRepo}
                      onChange={(e) => updateField("githubRepo", e.target.value)}
                      className="bt-input"
                      placeholder="owner/repository"
                    />
                  </Field>
                  <Field label="Branch" hint="Default deployment branch.">
                    <input
                      type="text"
                      value={form.githubBranch}
                      onChange={(e) => updateField("githubBranch", e.target.value)}
                      className="bt-input"
                      placeholder="main"
                    />
                  </Field>
                </div>

                <Field label="GitHub token" hint="Personal access token with repo read access. Stored locally only.">
                  <input
                    type="password"
                    value={form.githubToken}
                    onChange={(e) => updateField("githubToken", e.target.value)}
                    className="bt-input"
                    placeholder="ghp_…"
                  />
                </Field>

                {statusMessage ? (
                  <div className="rounded-xl border border-[var(--border-mid)] bg-[#0f1621] p-3">
                    <p className="text-xs text-[var(--text-primary)]">{statusMessage}</p>
                    {discoveredCount !== null ? (
                      <p className="text-xs text-[var(--accent-green)] mt-1 bt-mono">
                        ✓ discovered {discoveredCount} service{discoveredCount === 1 ? "" : "s"}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {lastAction === "connect" && discoveredCount !== null ? (
                  <div className="rounded-xl border border-[rgba(167,139,250,0.28)] bg-[rgba(167,139,250,0.06)] p-4 flex gap-3">
                    <Info size={15} className="text-[var(--accent-violet)] mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p className="text-[12px] font-medium text-[var(--text-primary)]">
                        Agent configured — LSI · TSD · Auto-rollback active
                      </p>
                      <p className="text-[11px] text-[var(--text-secondary)]">
                        BackTrack agent at{" "}
                        <code className="bt-mono text-[var(--accent-violet)]">
                          http://localhost:9090
                        </code>{" "}
                        has been reconfigured to monitor{" "}
                        <code className="bt-mono text-[var(--accent-teal)]">{form.appName || "your app"}</code>.
                        No restart needed.
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                        Agent not running yet? Start it with:
                      </p>
                      <code className="block mt-2 bt-mono text-[11px] text-[var(--accent-teal)] bg-black/40 border border-[var(--border-soft)] rounded-md px-3 py-2 whitespace-pre-wrap break-all">
                        docker compose up
                      </code>
                    </div>
                  </div>
                ) : null}

                {isDocker ? (
                  <div className="rounded-xl border border-[var(--border-soft)] bg-[rgba(148,163,184,0.03)] p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Boxes size={14} className="text-[var(--accent-teal)]" />
                      <h3 className="text-sm text-white">Docker setup</h3>
                    </div>
                    <ol className="space-y-3 text-xs text-[var(--text-secondary)] list-decimal list-inside">
                      <li>
                        Find your container name:
                        <code className="block mt-1.5 bt-mono text-[11.5px] text-[var(--accent-teal)] bg-black/40 border border-[var(--border-soft)] rounded-md px-3 py-2">
                          docker ps --format &quot;&#123;&#123;.Names&#125;&#125;&quot;
                        </code>
                      </li>
                      <li>
                        Enter that name in <strong>Application name</strong> above, then click Connect.
                      </li>
                    </ol>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[var(--border-soft)] bg-[rgba(148,163,184,0.03)] p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Boxes size={14} className="text-[var(--accent-violet)]" />
                      <h3 className="text-sm text-white">Getting credentials</h3>
                    </div>
                    <ol className="space-y-3 text-xs text-[var(--text-secondary)] list-decimal list-inside">
                      <li>
                        Cluster API endpoint:
                        <code className="block mt-1.5 bt-mono text-[11.5px] text-[var(--accent-teal)] bg-black/40 border border-[var(--border-soft)] rounded-md px-3 py-2">
                          kubectl cluster-info
                        </code>
                      </li>
                      <li>
                        Service account token:
                        <code className="block mt-1.5 bt-mono text-[11.5px] text-[var(--accent-teal)] bg-black/40 border border-[var(--border-soft)] rounded-md px-3 py-2 whitespace-pre-wrap break-all">
                          kubectl create token default --duration=24h
                        </code>
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 border-t border-[var(--border-soft)] bg-[#0b1018]/95 backdrop-blur px-6 sm:px-8 py-4 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 rounded-lg border border-[var(--border-soft)] bg-white/[0.02] text-[var(--text-secondary)] hover:text-white hover:bg-white/[0.05] text-sm"
              >
                Cancel
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => submitConnection("test")}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-lg border border-[var(--border-mid)] bg-white/[0.02] text-[var(--text-primary)] hover:bg-white/[0.05] text-sm disabled:opacity-50"
                >
                  {isSubmitting ? "Testing…" : "Test connection"}
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => submitConnection("connect")}
                  className="flex-1 sm:flex-none px-4 py-2 rounded-lg border border-[rgba(94,234,212,0.45)] bg-[rgba(94,234,212,0.12)] text-[#d7f7ee] hover:bg-[rgba(94,234,212,0.2)] text-sm disabled:opacity-50"
                >
                  {isSubmitting ? "Connecting…" : "Connect"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <style jsx>{`
        :global(.bt-input) {
          width: 100%;
          margin-top: 6px;
          border-radius: 10px;
          border: 1px solid var(--border-soft);
          background: rgba(148, 163, 184, 0.04);
          padding: 10px 12px;
          font-size: 13px;
          color: var(--text-primary);
          font-family: var(--font-plex-mono), monospace;
          transition: border-color 160ms ease, background 160ms ease;
        }
        :global(.bt-input:focus) {
          outline: none;
          border-color: rgba(94, 234, 212, 0.45);
          background: rgba(94, 234, 212, 0.04);
        }
      `}</style>
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}

export default Nav;
