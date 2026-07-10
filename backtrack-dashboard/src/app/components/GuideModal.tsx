"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Plug,
  RotateCcw,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import React, { useState } from "react";

type GuideSection =
  | "overview"
  | "connect"
  | "agent"
  | "dashboard"
  | "anomalies"
  | "rollback"
  | "troubleshooting";

type GuideModalProps = {
  open: boolean;
  onClose: () => void;
  section: GuideSection;
  onSectionChange: (section: GuideSection) => void;
};

const STEPS: { id: GuideSection; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "What is BackTrack?", shortLabel: "Overview", icon: <BookOpen size={14} /> },
  { id: "connect", label: "Connect your cluster", shortLabel: "Connect", icon: <Plug size={14} /> },
  { id: "agent", label: "Start the agent", shortLabel: "Agent", icon: <Zap size={14} /> },
  { id: "dashboard", label: "Read the dashboard", shortLabel: "Dashboard", icon: <Activity size={14} /> },
  { id: "anomalies", label: "Investigate anomalies", shortLabel: "Anomalies", icon: <AlertTriangle size={14} /> },
  { id: "rollback", label: "Rollback safely", shortLabel: "Rollback", icon: <RotateCcw size={14} /> },
  { id: "troubleshooting", label: "Troubleshooting", shortLabel: "Help", icon: <Terminal size={14} /> },
];

function CopyBlock({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="relative group mt-2">
      <code className="block bt-mono text-[11px] text-[var(--accent-teal)] bg-[var(--surface-code-bg)] border border-[var(--border-soft)] rounded-md px-3 py-2 pr-9 whitespace-pre-wrap break-all">
        {cmd}
      </code>
      <button
        type="button"
        onClick={copy}
        title="Copy"
        className="absolute right-2 top-2 text-[var(--text-muted)] hover:text-[var(--accent-teal)] transition-colors"
      >
        {copied ? <Check size={13} className="text-[var(--accent-teal)]" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-bg-soft)] bt-mono text-[11px] font-semibold text-[var(--accent-teal)]">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="text-[13px] font-semibold text-[var(--text-primary)] mb-1">{title}</h4>
        <div className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{children}</div>
      </div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-glass-strong)] p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)] mb-1.5">{title}</p>
      <div className="text-[12.5px] leading-relaxed text-[var(--text-secondary)]">{children}</div>
    </div>
  );
}

function SectionContent({ section }: { section: GuideSection }) {
  switch (section) {
    case "overview":
      return (
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
            BackTrack is a <strong className="text-[var(--text-primary)]">local-first</strong> observability dashboard for Docker and Kubernetes.
            It watches your services, detects anomalies with two ML algorithms, and can automatically roll back to the last stable version.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard title="TSD — Time Series Decomposition">
              Monitors CPU, memory, latency, and error rate. Flags drift when metric residuals exceed 3×IQR for three consecutive readings (~2 min warmup).
            </InfoCard>
            <InfoCard title="LSI — Latent Semantic Indexing">
              Classifies live logs (INFO / WARN / ERROR / NOVEL) using TF-IDF + SVD. Scores log windows against a rolling baseline (~5 min warmup).
            </InfoCard>
          </div>
          <InfoCard title="What you will do next">
            <ol className="list-decimal list-inside space-y-1 mt-1">
              <li>Connect a Docker daemon or Kubernetes cluster</li>
              <li>Start the Python agent on port <span className="bt-mono text-[var(--accent-teal)]">8847</span></li>
              <li>Wait ~2 min for TSD and ~5 min for LSI baselines</li>
              <li>Monitor the dashboard; roll back manually or let auto-rollback run</li>
            </ol>
          </InfoCard>
        </div>
      );

    case "connect":
      return (
        <div className="space-y-5">
          <Step n={1} title="Open Configure Cluster">
            Click <strong className="text-[var(--text-primary)]">Configure Cluster</strong> in the top-right (or the button on the empty dashboard).
          </Step>
          <Step n={2} title="Choose your platform">
            <p className="mb-2"><strong className="text-[var(--text-primary)]">Docker</strong> — enter a container name or Compose project name. Architecture <em>Microservices</em> discovers all containers in a Compose project.</p>
            <p><strong className="text-[var(--text-primary)]">Kubernetes</strong> — enter your namespace and deployment name (or use Microservices to discover all deployments in the namespace).</p>
          </Step>
          <Step n={3} title="Verify discovery">
            <p className="mb-2">List what BackTrack can see before connecting:</p>
            <CopyBlock cmd={'docker ps --format "{{.Names}}"'} />
            <CopyBlock cmd={"kubectl get deployments -n default"} />
          </Step>
          <Step n={4} title="Optional: GitHub & Prometheus">
            <p>Add a GitHub repo + token for deployment history and CI/CD. Add a Prometheus URL for richer request-rate metrics (falls back to kubectl top / docker stats).</p>
          </Step>
        </div>
      );

    case "agent":
      return (
        <div className="space-y-5">
          <p className="text-[13px] text-[var(--text-secondary)]">
            The <strong className="text-[var(--text-primary)]">backtrack-agent</strong> runs TSD collectors, LSI log analysis, version snapshots, and rollback execution. The dashboard proxies to it on port <span className="bt-mono text-[var(--accent-teal)]">8847</span>.
          </p>
          <Step n={1} title="Install dependencies">
            <CopyBlock cmd={"cd backtrack-agent\npython3 -m venv .venv\n.venv/bin/pip install -r requirements.txt"} />
          </Step>
          <Step n={2} title="Start for Docker">
            <CopyBlock cmd={'BACKTRACK_MODE=docker \\\nBACKTRACK_TARGET=<container-name> \\\nBACKTRACK_IMAGE_TAG=latest \\\n.venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 8847'} />
          </Step>
          <Step n={3} title="Start for Kubernetes">
            <CopyBlock cmd={'BACKTRACK_MODE=kubernetes \\\nBACKTRACK_K8S_NAMESPACE=default \\\nBACKTRACK_TARGET=<deployment-name> \\\nBACKTRACK_IMAGE_TAG=latest \\\n.venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 8847'} />
          </Step>
          <Step n={4} title="Verify agent health">
            <CopyBlock cmd={"curl http://127.0.0.1:8847/health"} />
            <p className="mt-2">A <span className="bt-mono">502</span> on dashboard API calls usually means the agent is not running.</p>
          </Step>
        </div>
      );

    case "dashboard":
      return (
        <div className="space-y-4">
          <p className="text-[13px] text-[var(--text-secondary)]">
            After connecting, the dashboard polls every <strong className="text-[var(--text-primary)]">10 seconds</strong> and shows live telemetry across four rows.
          </p>
          <div className="space-y-3">
            {[
              { title: "Container Health", desc: "CPU, memory, request rate, and network charts per service. Click a service chip to open diagnostics." },
              { title: "Recent Deployments", desc: "Rollout history from kubectl or GitHub. Roll back to a previous version from this panel." },
              { title: "Anomaly Detection", desc: "Active TSD/LSI alerts with severity. Trigger rollback directly from an anomaly row." },
              { title: "Active Containers", desc: "Table of discovered services with platform, status, namespace, and ports." },
              { title: "CI/CD & Rollbacks", desc: "GitHub commits, workflow runs, and GHCR image tags when a repo is linked. Recent rollback audit trail." },
            ].map((item) => (
              <InfoCard key={item.title} title={item.title}>
                {item.desc}
              </InfoCard>
            ))}
          </div>
        </div>
      );

    case "anomalies":
      return (
        <div className="space-y-5">
          <p className="text-[13px] text-[var(--text-secondary)]">
            Open <strong className="text-[var(--text-primary)]">Anomalies</strong> from the nav for per-service TSD/LSI panels and an embedded kubectl terminal.
          </p>
          <Step n={1} title="Warmup progress">
            TSD needs ~12 readings (~2 min). LSI needs ~200 log lines plus baseline lock (~5 min). Progress bars show status on the Anomalies page.
          </Step>
          <Step n={2} title="Service diagnostics">
            Click any service to see live metrics decomposition, LSI scores, classified log stream, root-cause analysis, and version history.
          </Step>
          <Step n={3} title="Terminal">
            Run kubectl or docker commands from the Anomalies page. Commands execute locally via the dashboard API — use only on trusted networks.
          </Step>
          <InfoCard title="Evaluation metrics">
            Visit <strong className="text-[var(--text-primary)]">Metrics</strong> for MTTR tracking and TSD/LSI confusion matrices (precision, recall, F1).
          </InfoCard>
        </div>
      );

    case "rollback":
      return (
        <div className="space-y-5">
          <Step n={1} title="Automatic rollback">
            After <strong className="text-[var(--text-primary)]">3 consecutive anomaly cycles</strong> (~90 s), the agent rolls back to the last STABLE snapshot. Container crashes trigger rollback immediately.
          </Step>
          <Step n={2} title="Manual rollback">
            Use the rollback button on an anomaly row, in Recent Deployments, or from the CI/CD Images tab (GHCR tags).
          </Step>
          <Step n={3} title="Version snapshots">
            The agent marks a version STABLE after ~2 min of clean operation. Snapshots move through PENDING → STABLE → ROLLED_BACK states.
          </Step>
          <InfoCard title="Docker rollback">
            Preserves ports, env vars, volumes, and network mode from docker inspect before recreating with the stable image tag.
          </InfoCard>
          <InfoCard title="Kubernetes rollback">
            Runs kubectl rollout undo. Restores replicas to 1 if the deployment was scaled to zero.
          </InfoCard>
        </div>
      );

    case "troubleshooting":
      return (
        <div className="space-y-3">
          {[
            { q: "Dashboard shows no services", a: "Open Configure Cluster and verify docker ps or kubectl get pods. The app name must match the container, Compose project, or deployment name." },
            { q: "Agent returns 502", a: "Start backtrack-agent on port 8847. Set BACKTRACK_AGENT_URL in .env.local if the agent runs on another host." },
            { q: "All metrics are zero", a: "Install metrics-server for Kubernetes (kubectl top pods). For Docker, ensure /var/run/docker.sock is accessible." },
            { q: "TSD/LSI panels empty", a: "Wait for warmup (~2 min TSD, ~5 min LSI). Service name in Connect must exactly match the deployment or container." },
            { q: "Rollback did not restore the app", a: "Check curl http://127.0.0.1:8847/rollback/history. Verify the agent has Docker socket or kubectl write access." },
          ].map((item) => (
            <div key={item.q} className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-glass-strong)] px-3.5 py-3">
              <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">{item.q}</p>
              <p className="text-[12px] text-[var(--text-secondary)] mt-1 leading-relaxed">{item.a}</p>
            </div>
          ))}
          <p className="text-[11px] text-[var(--text-muted)] pt-1">
            Full docs: README.md in the BackTrack repository.
          </p>
        </div>
      );
  }
}

function GuideChainSidebar({
  currentIndex,
  onSectionChange,
}: {
  currentIndex: number;
  onSectionChange: (section: GuideSection) => void;
}) {
  return (
    <aside className="hidden sm:flex w-[11.5rem] shrink-0 flex-col border-r border-[var(--border-soft)] bg-[var(--surface-glass-strong)]">
      <div className="px-4 py-4 border-b border-[var(--border-soft)]">
        <p className="bt-label">Guide</p>
        <p className="text-[10px] text-[var(--text-muted)] mt-1.5">
          Step {currentIndex + 1} of {STEPS.length}
        </p>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3 scrollbar-hide" aria-label="Guide steps">
        <ol className="flex flex-col">
          {STEPS.map((step, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            const upcoming = i > currentIndex;
            const canJump = done;

            return (
              <li key={step.id} className="flex gap-2.5">
                <div className="flex w-9 shrink-0 flex-col items-center">
                  <div className="flex h-10 w-full items-center justify-center">
                    <button
                      type="button"
                      disabled={upcoming}
                      onClick={() => canJump && onSectionChange(step.id)}
                      aria-current={active ? "step" : undefined}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold bt-mono transition ${
                        active
                          ? "border-[var(--accent-border-strong)] bg-[var(--accent-bg-medium)] text-[var(--text-accent-light)] shadow-[0_0_0_3px_var(--accent-bg-soft)]"
                          : done
                            ? "border-[var(--accent-border)] bg-[var(--accent-bg-soft)] text-[var(--accent-teal)] hover:bg-[var(--accent-bg-medium)] cursor-pointer"
                            : "border-[var(--border-soft)] bg-[var(--surface-glass-strong)] text-[var(--text-muted)] cursor-default"
                      }`}
                    >
                      {done ? <Check size={12} /> : i + 1}
                    </button>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className={`w-px h-4 shrink-0 transition-colors ${
                        i < currentIndex ? "bg-[var(--accent-teal)]" : "bg-[var(--border-soft)]"
                      }`}
                      aria-hidden
                    />
                  )}
                </div>

                <button
                  type="button"
                  disabled={upcoming}
                  onClick={() => canJump && onSectionChange(step.id)}
                  className={`mb-0.5 flex h-10 min-w-0 flex-1 items-center rounded-lg px-2.5 text-left transition ${
                    active
                      ? "bg-[var(--accent-bg-soft)] border border-[var(--accent-border)]"
                      : done
                        ? "border border-transparent hover:bg-[var(--surface-glass-hover)] cursor-pointer"
                        : "border border-transparent cursor-default"
                  }`}
                >
                  <span
                    className={`flex items-center gap-2 text-[12px] leading-none ${
                      active
                        ? "text-[var(--text-accent-light)] font-medium"
                        : done
                          ? "text-[var(--accent-teal)]"
                          : "text-[var(--text-muted)]"
                    }`}
                  >
                    <span className={`shrink-0 ${active ? "text-[var(--accent-teal)]" : done ? "text-[var(--accent-teal)]" : "text-[var(--text-muted)]"}`}>
                      {step.icon}
                    </span>
                    <span className="truncate">{step.shortLabel}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </aside>
  );
}

function GuideChainMobile({ currentIndex }: { currentIndex: number }) {
  return (
    <div className="sm:hidden px-5 pt-3 shrink-0">
      <div className="flex items-center justify-center gap-1">
        {STEPS.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <React.Fragment key={step.id}>
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold bt-mono ${
                  active
                    ? "border-[var(--accent-border-strong)] bg-[var(--accent-bg-medium)] text-[var(--text-accent-light)]"
                    : done
                      ? "border-[var(--accent-border)] bg-[var(--accent-bg-soft)] text-[var(--accent-teal)]"
                      : "border-[var(--border-soft)] bg-[var(--surface-glass-strong)] text-[var(--text-muted)]"
                }`}
              >
                {done ? <Check size={10} /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px w-3 ${i < currentIndex ? "bg-[var(--accent-teal)]" : "bg-[var(--border-soft)]"}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[10px] text-[var(--text-muted)]">
        {currentIndex + 1} / {STEPS.length} · {STEPS[currentIndex].shortLabel}
      </p>
    </div>
  );
}

export default function GuideModal({ open, onClose, section, onSectionChange }: GuideModalProps) {
  if (!open) return null;

  const currentIndex = Math.max(0, STEPS.findIndex((s) => s.id === section));
  const current = STEPS[currentIndex];
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === STEPS.length - 1;

  const goBack = () => {
    if (!isFirst) onSectionChange(STEPS[currentIndex - 1].id);
  };

  const goNext = () => {
    if (!isLast) onSectionChange(STEPS[currentIndex + 1].id);
  };

  const finish = () => {
    try {
      localStorage.setItem("backtrack-guide-seen", "1");
    } catch {
      /* ignore */
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] backdrop-blur-sm px-4 py-6">
      <div className="relative flex w-full max-w-[900px] max-h-[92vh] overflow-hidden rounded-2xl border border-[var(--border-mid)] bg-[var(--surface-modal)] shadow-[var(--shadow-modal)]">

        <GuideChainSidebar currentIndex={currentIndex} onSectionChange={onSectionChange} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative h-16 bt-grid border-b border-[var(--border-soft)] overflow-hidden shrink-0">
            <div className="absolute inset-0 bg-gradient-to-r from-[rgba(94,234,212,0.10)] via-transparent to-[rgba(167,139,250,0.12)]" />
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 h-8 w-8 rounded-full border border-[var(--border-soft)] bg-[var(--surface-glass-strong)] hover:bg-[var(--surface-glass-hover)] flex items-center justify-center text-[var(--text-secondary)]"
              aria-label="Close guide"
            >
              <X size={16} />
            </button>
          </div>

          <GuideChainMobile currentIndex={currentIndex} />

          <div className="px-5 sm:px-7 -mt-6 sm:-mt-8 relative shrink-0">
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 rounded-2xl border border-[var(--border-mid)] bg-[var(--surface-dropdown)] flex items-center justify-center shrink-0 text-[var(--accent-teal)]">
                {current.icon}
              </div>
              <div className="pt-0.5 min-w-0">
                <h2 className="bt-display text-[22px] sm:text-[24px] leading-tight text-[var(--text-brand-white)]">
                  {current.label}
                </h2>
                <p className="text-[11.5px] text-[var(--text-secondary)] mt-1">
                  {isFirst
                    ? "Welcome — follow each step top to bottom."
                    : isLast
                      ? "Last step — common issues and where to look for help."
                      : "Complete this step, then hit Next to continue down the chain."}
                </p>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-5 scrollbar-hide">
            <SectionContent section={section} />
          </div>

          <div className="shrink-0 border-t border-[var(--border-soft)] px-5 sm:px-7 py-3.5 flex items-center justify-between gap-3 bg-[var(--surface-modal-scrim)]">
            <button
              type="button"
              onClick={goBack}
              disabled={isFirst}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-soft)] text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-glass-hover)] hover:text-[var(--text-primary)] transition disabled:opacity-35 disabled:pointer-events-none"
            >
              <ArrowLeft size={14} />
              Back
            </button>

            <p className="text-[10.5px] text-[var(--text-muted)] hidden sm:block">
              Press <span className="bt-kbd">?</span> to reopen
            </p>

            {isLast ? (
              <button
                type="button"
                onClick={finish}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--accent-border-strong)] bg-[var(--accent-bg-medium)] text-[var(--text-accent-light)] hover:bg-[var(--accent-bg-strong)] text-sm transition"
              >
                <Check size={14} />
                Finish guide
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[var(--accent-border-strong)] bg-[var(--accent-bg-medium)] text-[var(--text-accent-light)] hover:bg-[var(--accent-bg-strong)] text-sm transition"
              >
                Next
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export type { GuideSection };
