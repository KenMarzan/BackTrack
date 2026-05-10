/**
 * Multi-channel notification dispatcher.
 * Config priority: explicit override > env vars > .backtrack/notifications.json
 *
 * Channels: Webhook (Slack/Teams/generic), Telegram, Email (SMTP/nodemailer)
 */
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";

export type ChannelWebhook  = { url: string; enabled: boolean };
export type ChannelTelegram = { token: string; chatId: string; enabled: boolean };
export type ChannelEmail    = { host: string; port: number; user: string; pass: string; from: string; to: string; enabled: boolean };

export type NotificationConfig = {
  webhook:  ChannelWebhook;
  telegram: ChannelTelegram;
  email:    ChannelEmail;
};

export type RollbackEvent = {
  service: string;
  namespace?: string;
  platform: string;
  from_tag?: string;
  to_tag?: string;
  success: boolean;
  message: string;
  triggered_at: string;
  source: "manual" | "cicd" | "agent";
};

const CONFIG_FILE = path.join(process.cwd(), ".backtrack", "notifications.json");

function readFileConfig(): Partial<NotificationConfig> {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as Partial<NotificationConfig>;
  } catch { return {}; }
}

export function loadNotificationConfig(): NotificationConfig {
  const f = readFileConfig();
  return {
    webhook: {
      url:     process.env.BACKTRACK_WEBHOOK_URL ?? f.webhook?.url ?? "",
      enabled: !!(process.env.BACKTRACK_WEBHOOK_URL ?? (f.webhook?.enabled && f.webhook?.url)),
    },
    telegram: {
      token:  process.env.BACKTRACK_TELEGRAM_TOKEN  ?? f.telegram?.token  ?? "",
      chatId: process.env.BACKTRACK_TELEGRAM_CHAT_ID ?? f.telegram?.chatId ?? "",
      enabled: !!(
        (process.env.BACKTRACK_TELEGRAM_TOKEN && process.env.BACKTRACK_TELEGRAM_CHAT_ID) ||
        (f.telegram?.enabled && f.telegram?.token && f.telegram?.chatId)
      ),
    },
    email: {
      host: process.env.BACKTRACK_SMTP_HOST ?? f.email?.host ?? "",
      port: Number(process.env.BACKTRACK_SMTP_PORT ?? f.email?.port ?? 587),
      user: process.env.BACKTRACK_SMTP_USER ?? f.email?.user ?? "",
      pass: process.env.BACKTRACK_SMTP_PASS ?? f.email?.pass ?? "",
      from: process.env.BACKTRACK_SMTP_FROM ?? f.email?.from ?? "",
      to:   process.env.BACKTRACK_SMTP_TO   ?? f.email?.to   ?? "",
      enabled: !!(
        (process.env.BACKTRACK_SMTP_HOST && process.env.BACKTRACK_SMTP_USER) ||
        (f.email?.enabled && f.email?.host && f.email?.user)
      ),
    },
  };
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatText(e: RollbackEvent): string {
  return [
    `[BackTrack] ${e.success ? "✅ ROLLBACK SUCCEEDED" : "❌ ROLLBACK FAILED"}`,
    `Service:   ${e.service}${e.namespace ? ` (${e.namespace})` : ""}`,
    `Platform:  ${e.platform}`,
    e.to_tag ? `Version:   → ${e.to_tag}` : "",
    `Triggered: ${e.triggered_at}`,
    `Source:    ${e.source}`,
    `Details:   ${e.message}`,
  ].filter(Boolean).join("\n");
}

function formatHtml(e: RollbackEvent): string {
  const color = e.success ? "#22c55e" : "#ef4444";
  const label = e.success ? "✅ Rollback Succeeded" : "❌ Rollback Failed";
  const rows: [string, string][] = [
    ["Service",  `${e.service}${e.namespace ? ` <em>(${e.namespace})</em>` : ""}`],
    ["Platform", e.platform],
    ...(e.to_tag ? [["Rolled back to", `<code>${e.to_tag}</code>`] as [string,string]] : []),
    ["Triggered", e.triggered_at],
    ["Source",   e.source],
    ["Details",  e.message],
  ];
  const trs = rows.map(([k,v]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap">${k}</td><td style="padding:4px 0">${v}</td></tr>`
  ).join("");
  return `<div style="font-family:sans-serif;max-width:520px"><h2 style="margin:0 0 16px;color:${color}">${label}</h2><table style="border-collapse:collapse;width:100%">${trs}</table><p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Sent by BackTrack</p></div>`;
}

function formatSlack(e: RollbackEvent): string {
  return JSON.stringify({
    attachments: [{
      color: e.success ? "#22c55e" : "#ef4444",
      title: e.success ? "✅ Rollback Succeeded" : "❌ Rollback Failed",
      fields: [
        { title: "Service",  value: e.service,  short: true },
        { title: "Platform", value: e.platform, short: true },
        ...(e.to_tag ? [{ title: "Rolled back to", value: e.to_tag, short: true }] : []),
        ...(e.namespace ? [{ title: "Namespace", value: e.namespace, short: true }] : []),
        { title: "Source",  value: e.source,  short: true },
        { title: "Details", value: e.message, short: false },
      ],
      footer: "BackTrack",
      ts: Math.floor(new Date(e.triggered_at).getTime() / 1000),
    }],
  });
}

// ── Dispatchers ───────────────────────────────────────────────────────────────

async function sendWebhook(e: RollbackEvent, cfg: ChannelWebhook): Promise<void> {
  if (!cfg.enabled || !cfg.url) return;
  const isSlack = cfg.url.includes("hooks.slack.com") || cfg.url.includes("discord.com/api/webhooks");
  await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: isSlack ? formatSlack(e) : JSON.stringify({ event: "backtrack.rollback", ...e }),
    signal: AbortSignal.timeout(5_000),
  });
}

async function sendTelegram(e: RollbackEvent, cfg: ChannelTelegram): Promise<void> {
  if (!cfg.enabled || !cfg.token || !cfg.chatId) return;
  await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: cfg.chatId, text: formatText(e) }),
    signal: AbortSignal.timeout(8_000),
  });
}

async function sendEmail(e: RollbackEvent, cfg: ChannelEmail): Promise<void> {
  if (!cfg.enabled || !cfg.host || !cfg.user || !cfg.pass || !cfg.to) return;
  const recipients = cfg.to.split(",").map(s => s.trim()).filter(Boolean);
  const transporter = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  await transporter.sendMail({
    from: cfg.from || cfg.user,
    to: recipients.join(", "),
    subject: e.success ? `[BackTrack] ✅ Rollback succeeded — ${e.service}` : `[BackTrack] ❌ Rollback failed — ${e.service}`,
    text: formatText(e),
    html: formatHtml(e),
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function notifyRollback(event: RollbackEvent, configOverride?: NotificationConfig): Promise<void> {
  const cfg = configOverride ?? loadNotificationConfig();
  await Promise.allSettled([
    sendWebhook(event, cfg.webhook),
    sendTelegram(event, cfg.telegram),
    sendEmail(event, cfg.email),
  ]);
}
