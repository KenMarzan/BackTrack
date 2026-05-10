"use client";
import { Bell, ChevronDown, ChevronRight, Mail, Send, Webhook, X } from "lucide-react";
import React, { useEffect, useState } from "react";

type ChannelWebhook  = { url: string; enabled: boolean };
type ChannelTelegram = { token: string; chatId: string; enabled: boolean };
type ChannelEmail    = { host: string; port: number; user: string; pass: string; from: string; to: string; enabled: boolean };

type NotificationConfig = {
  webhook:  ChannelWebhook;
  telegram: ChannelTelegram;
  email:    ChannelEmail;
};

type TestResult = "idle" | "sending" | "ok" | string;

type NotificationsModalProps = {
  open: boolean;
  onClose: () => void;
};

const DEFAULT_CONFIG: NotificationConfig = {
  webhook:  { url: "", enabled: false },
  telegram: { token: "", chatId: "", enabled: false },
  email:    { host: "", port: 587, user: "", pass: "", from: "", to: "", enabled: false },
};

function ResultBadge({ result }: { result: TestResult }) {
  if (result === "idle") return null;
  if (result === "sending") return (
    <span className="text-[10px] text-[var(--text-muted)] animate-pulse">Sending…</span>
  );
  if (result === "ok") return (
    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><polyline points="1.5 6 4.5 9 10.5 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
      Sent
    </span>
  );
  if (result === "disabled") return (
    <span className="text-[10px] text-[var(--text-muted)]">Channel disabled</span>
  );
  return (
    <span className="text-[10px] text-rose-400 truncate max-w-[200px]" title={result}>Error: {result}</span>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border transition-colors duration-200 focus:outline-none"
      style={{
        borderColor: checked ? "rgba(94,234,212,0.5)" : "rgba(148,163,184,0.2)",
        background: checked ? "rgba(94,234,212,0.15)" : "rgba(148,163,184,0.06)",
      }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full transition-transform duration-200 mt-[3px]"
        style={{
          transform: checked ? "translateX(18px)" : "translateX(3px)",
          background: checked ? "var(--accent-teal)" : "rgba(148,163,184,0.4)",
          boxShadow: checked ? "0 0 6px rgba(94,234,212,0.5)" : "none",
        }}
      />
    </button>
  );
}

function SectionHeader({
  icon,
  label,
  enabled,
  expanded,
  onToggleEnabled,
  onToggleExpanded,
}: {
  icon: React.ReactNode;
  label: string;
  enabled: boolean;
  expanded: boolean;
  onToggleEnabled: (v: boolean) => void;
  onToggleExpanded: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none rounded-xl"
      style={{ background: "rgba(148,163,184,0.03)" }}
      onClick={onToggleExpanded}
    >
      <div
        className="h-7 w-7 rounded-lg border flex items-center justify-center flex-shrink-0"
        style={{
          borderColor: enabled ? "rgba(94,234,212,0.3)" : "rgba(148,163,184,0.15)",
          background: enabled ? "rgba(94,234,212,0.07)" : "rgba(148,163,184,0.04)",
        }}
      >
        {icon}
      </div>
      <span className="flex-1 text-[13px] font-medium text-[var(--text-primary)]">{label}</span>
      <div onClick={(e) => { e.stopPropagation(); }} className="mr-2">
        <ToggleSwitch checked={enabled} onChange={onToggleEnabled} />
      </div>
      {expanded
        ? <ChevronDown size={14} className="text-[var(--text-muted)] flex-shrink-0" />
        : <ChevronRight size={14} className="text-[var(--text-muted)] flex-shrink-0" />
      }
    </div>
  );
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10.5px] uppercase tracking-[0.15em] text-[var(--text-secondary)]">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

export default function NotificationsModal({ open, onClose }: NotificationsModalProps) {
  const [config, setConfig] = useState<NotificationConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [expanded, setExpanded] = useState({ webhook: false, telegram: false, email: false });
  const [testResults, setTestResults] = useState<{ webhook: TestResult; telegram: TestResult; email: TestResult }>({
    webhook: "idle", telegram: "idle", email: "idle",
  });

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/notifications/settings")
      .then(r => r.json())
      .then((data: NotificationConfig) => {
        setConfig({
          webhook:  { ...DEFAULT_CONFIG.webhook,  ...data.webhook },
          telegram: { ...DEFAULT_CONFIG.telegram, ...data.telegram },
          email:    { ...DEFAULT_CONFIG.email,    ...data.email },
        });
      })
      .catch(() => {/* use defaults */})
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const updateWebhook  = (patch: Partial<ChannelWebhook>)  => setConfig(c => ({ ...c, webhook:  { ...c.webhook,  ...patch } }));
  const updateTelegram = (patch: Partial<ChannelTelegram>) => setConfig(c => ({ ...c, telegram: { ...c.telegram, ...patch } }));
  const updateEmail    = (patch: Partial<ChannelEmail>)    => setConfig(c => ({ ...c, email:    { ...c.email,    ...patch } }));

  const handleSave = async () => {
    setSaving(true);
    setSaveOk(false);
    try {
      await fetch("/api/notifications/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (channel: "webhook" | "telegram" | "email") => {
    setTestResults(r => ({ ...r, [channel]: "sending" }));
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const data = await res.json();
      const result = data?.results?.[channel] ?? "error";
      setTestResults(r => ({ ...r, [channel]: result }));
    } catch (e) {
      setTestResults(r => ({ ...r, [channel]: String(e) }));
    }
  };

  const inputCls = "bt-input w-full mt-1.5";
  const testBtnCls = "inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-soft)] text-[var(--text-secondary)] hover:text-[var(--accent-teal)] hover:border-[rgba(94,234,212,0.3)] transition disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-6">
      <div className="relative w-full max-w-[680px] max-h-[92vh] overflow-y-auto rounded-2xl border border-[var(--border-mid)] bg-[#0b1018] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)] scrollbar-hide">

        {/* Decorative header band */}
        <div className="relative h-20 bt-grid border-b border-[var(--border-soft)] overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-[rgba(94,234,212,0.10)] via-transparent to-[rgba(167,139,250,0.12)]" />
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 h-8 w-8 rounded-full border border-[var(--border-soft)] bg-white/[0.03] hover:bg-white/[0.06] flex items-center justify-center text-[var(--text-secondary)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Title area */}
        <div className="px-6 sm:px-8 -mt-10 relative">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-2xl border border-[var(--border-mid)] bg-[#0f1621] flex items-center justify-center flex-shrink-0">
              <Bell size={22} className="text-[var(--accent-teal)]" />
            </div>
            <div className="pt-1.5">
              <h2 className="bt-display text-[26px] leading-tight text-white">
                Notification <span className="italic text-[var(--accent-teal)]">settings</span>
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Configure webhook, Telegram, and email channels for rollback alerts.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="mt-8 mb-6 flex items-center justify-center py-10 text-[var(--text-muted)] text-sm">
              Loading settings…
            </div>
          ) : (
            <div className="mt-6 space-y-3 pb-6">

              {/* ── Webhook ── */}
              <div className="rounded-xl border border-[var(--border-soft)] overflow-hidden">
                <SectionHeader
                  icon={<Webhook size={14} className={config.webhook.enabled ? "text-[var(--accent-teal)]" : "text-[var(--text-muted)]"} />}
                  label="Webhook"
                  enabled={config.webhook.enabled}
                  expanded={expanded.webhook}
                  onToggleEnabled={(v) => updateWebhook({ enabled: v })}
                  onToggleExpanded={() => setExpanded(e => ({ ...e, webhook: !e.webhook }))}
                />
                {expanded.webhook && (
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t border-[var(--border-soft)]">
                    <FieldRow label="Webhook URL" hint="Slack, Discord, Teams, or any HTTP POST endpoint.">
                      <input
                        type="url"
                        value={config.webhook.url}
                        onChange={e => updateWebhook({ url: e.target.value })}
                        className={inputCls}
                        placeholder="https://hooks.slack.com/services/…"
                      />
                    </FieldRow>
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        disabled={!config.webhook.enabled || !config.webhook.url || testResults.webhook === "sending"}
                        onClick={() => handleTest("webhook")}
                        className={testBtnCls}
                      >
                        <Send size={11} />
                        Send test
                      </button>
                      <ResultBadge result={testResults.webhook} />
                    </div>
                  </div>
                )}
              </div>

              {/* ── Telegram ── */}
              <div className="rounded-xl border border-[var(--border-soft)] overflow-hidden">
                <SectionHeader
                  icon={
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={config.telegram.enabled ? "text-[var(--accent-teal)]" : "text-[var(--text-muted)]"}>
                      <path d="M21.8 2.2L1.3 10.1c-1.3.5-1.3 1.3-.2 1.6l5.2 1.6 2 6.2c.3.8.1 1.1.9.9l3-2.8 5.9 4.4c1.1.6 1.9.3 2.1-.9l3.8-17.8c.4-1.6-.5-2.3-1.9-1.8z" fill="currentColor" opacity=".4"/>
                      <path d="M6.5 11.5l10.8-6.8c.6-.3 1.1 0 .7.5L9.1 14l-.3 3.5-2.3-6z" fill="currentColor"/>
                    </svg>
                  }
                  label="Telegram"
                  enabled={config.telegram.enabled}
                  expanded={expanded.telegram}
                  onToggleEnabled={(v) => updateTelegram({ enabled: v })}
                  onToggleExpanded={() => setExpanded(e => ({ ...e, telegram: !e.telegram }))}
                />
                {expanded.telegram && (
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t border-[var(--border-soft)]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FieldRow label="Bot token" hint="From @BotFather.">
                        <input
                          type="password"
                          value={config.telegram.token}
                          onChange={e => updateTelegram({ token: e.target.value })}
                          className={inputCls}
                          placeholder="1234567890:ABC…"
                        />
                      </FieldRow>
                      <FieldRow label="Chat ID" hint="Numeric chat or group ID.">
                        <input
                          type="text"
                          value={config.telegram.chatId}
                          onChange={e => updateTelegram({ chatId: e.target.value })}
                          className={inputCls}
                          placeholder="-100123456789"
                        />
                      </FieldRow>
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        disabled={!config.telegram.enabled || !config.telegram.token || !config.telegram.chatId || testResults.telegram === "sending"}
                        onClick={() => handleTest("telegram")}
                        className={testBtnCls}
                      >
                        <Send size={11} />
                        Send test
                      </button>
                      <ResultBadge result={testResults.telegram} />
                    </div>
                  </div>
                )}
              </div>

              {/* ── Email ── */}
              <div className="rounded-xl border border-[var(--border-soft)] overflow-hidden">
                <SectionHeader
                  icon={<Mail size={14} className={config.email.enabled ? "text-[var(--accent-teal)]" : "text-[var(--text-muted)]"} />}
                  label="Email (SMTP)"
                  enabled={config.email.enabled}
                  expanded={expanded.email}
                  onToggleEnabled={(v) => updateEmail({ enabled: v })}
                  onToggleExpanded={() => setExpanded(e => ({ ...e, email: !e.email }))}
                />
                {expanded.email && (
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t border-[var(--border-soft)]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FieldRow label="SMTP host">
                        <input
                          type="text"
                          value={config.email.host}
                          onChange={e => updateEmail({ host: e.target.value })}
                          className={inputCls}
                          placeholder="smtp.gmail.com"
                        />
                      </FieldRow>
                      <FieldRow label="Port">
                        <input
                          type="number"
                          value={config.email.port}
                          onChange={e => updateEmail({ port: Number(e.target.value) })}
                          className={inputCls}
                          placeholder="587"
                        />
                      </FieldRow>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FieldRow label="Username">
                        <input
                          type="text"
                          value={config.email.user}
                          onChange={e => updateEmail({ user: e.target.value })}
                          className={inputCls}
                          placeholder="you@example.com"
                        />
                      </FieldRow>
                      <FieldRow label="Password / App password">
                        <input
                          type="password"
                          value={config.email.pass}
                          onChange={e => updateEmail({ pass: e.target.value })}
                          className={inputCls}
                          placeholder="••••••••••••"
                        />
                      </FieldRow>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FieldRow label="From address">
                        <input
                          type="email"
                          value={config.email.from}
                          onChange={e => updateEmail({ from: e.target.value })}
                          className={inputCls}
                          placeholder="backtrack@example.com"
                        />
                      </FieldRow>
                      <FieldRow label="To address(es)" hint="Comma-separated for multiple recipients.">
                        <input
                          type="text"
                          value={config.email.to}
                          onChange={e => updateEmail({ to: e.target.value })}
                          className={inputCls}
                          placeholder="ops@example.com, team@example.com"
                        />
                      </FieldRow>
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        disabled={!config.email.enabled || !config.email.host || !config.email.user || testResults.email === "sending"}
                        onClick={() => handleTest("email")}
                        className={testBtnCls}
                      >
                        <Send size={11} />
                        Send test
                      </button>
                      <ResultBadge result={testResults.email} />
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 border-t border-[var(--border-soft)] bg-[#0b1018]/95 backdrop-blur px-6 sm:px-8 py-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[var(--border-soft)] bg-white/[0.02] text-[var(--text-secondary)] hover:text-white hover:bg-white/[0.05] text-sm transition"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            {saveOk && (
              <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><polyline points="1.5 6 4.5 9 10.5 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Saved
              </span>
            )}
            <button
              type="button"
              disabled={saving || loading}
              onClick={handleSave}
              className="px-5 py-2 rounded-lg border border-[rgba(94,234,212,0.45)] bg-[rgba(94,234,212,0.12)] text-[#d7f7ee] hover:bg-[rgba(94,234,212,0.2)] text-sm disabled:opacity-50 transition"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
