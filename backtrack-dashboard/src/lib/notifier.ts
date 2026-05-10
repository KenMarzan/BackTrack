/**
 * Multi-channel notification dispatcher.
 * Config priority: explicit override > env vars > .backtrack/notifications.json
 *
 * Email providers (in priority order):
 *   1. Resend  — set BACKTRACK_RESEND_API_KEY  (free: 3 000 emails/month)
 *   2. SMTP    — set BACKTRACK_SMTP_HOST + BACKTRACK_SMTP_USER + BACKTRACK_SMTP_PASS
 */
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import {
  fmtTs,
  fmtMttr,
  formatRollbackHtml,
  formatRollbackText,
  formatConnectionSuccessHtml,
  formatConnectionSuccessText,
  type RollbackEvent,
} from "@/lib/email-templates";

export type { RollbackEvent } from "@/lib/email-templates";

export type ChannelWebhook = { url: string; enabled: boolean };
export type ChannelTelegram = {
  token: string;
  chatId: string;
  enabled: boolean;
};
export type ChannelEmail = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string;
  enabled: boolean;
};

export type NotificationConfig = {
  webhook: ChannelWebhook;
  telegram: ChannelTelegram;
  email: ChannelEmail;
};

const CONFIG_FILE = path.join(
  process.cwd(),
  ".backtrack",
  "notifications.json",
);

function readFileConfig(): Partial<NotificationConfig> {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(
      fs.readFileSync(CONFIG_FILE, "utf-8"),
    ) as Partial<NotificationConfig>;
  } catch {
    return {};
  }
}

export function loadNotificationConfig(): NotificationConfig {
  const f = readFileConfig();
  const resendConfigured = !!process.env.BACKTRACK_RESEND_API_KEY;
  const smtpConfigured = !!(
    process.env.BACKTRACK_SMTP_HOST && process.env.BACKTRACK_SMTP_USER
  );
  return {
    webhook: {
      url: process.env.BACKTRACK_WEBHOOK_URL ?? f.webhook?.url ?? "",
      enabled: !!(
        process.env.BACKTRACK_WEBHOOK_URL ??
        (f.webhook?.enabled && f.webhook?.url)
      ),
    },
    telegram: {
      token: process.env.BACKTRACK_TELEGRAM_TOKEN ?? f.telegram?.token ?? "",
      chatId:
        process.env.BACKTRACK_TELEGRAM_CHAT_ID ?? f.telegram?.chatId ?? "",
      enabled: !!(
        (process.env.BACKTRACK_TELEGRAM_TOKEN &&
          process.env.BACKTRACK_TELEGRAM_CHAT_ID) ||
        (f.telegram?.enabled && f.telegram?.token && f.telegram?.chatId)
      ),
    },
    email: {
      host: process.env.BACKTRACK_SMTP_HOST ?? f.email?.host ?? "",
      port: Number(process.env.BACKTRACK_SMTP_PORT ?? f.email?.port ?? 587),
      user: process.env.BACKTRACK_SMTP_USER ?? f.email?.user ?? "",
      pass: process.env.BACKTRACK_SMTP_PASS ?? f.email?.pass ?? "",
      from: process.env.BACKTRACK_SMTP_FROM ?? f.email?.from ?? "",
      to: process.env.BACKTRACK_SMTP_TO ?? f.email?.to ?? "",
      enabled: !!(
        resendConfigured ||
        smtpConfigured ||
        (f.email?.enabled && f.email?.to)
      ),
    },
  };
}

// ── Slack formatter (stays here, not email) ───────────────────────────────────

function formatSlack(e: RollbackEvent): string {
  return JSON.stringify({
    attachments: [
      {
        color: e.success ? "#10b981" : "#ef4444",
        title: e.success ? "✅ Rollback Succeeded" : "❌ Rollback Failed",
        fields: [
          { title: "Service", value: e.service, short: true },
          { title: "Platform", value: e.platform, short: true },
          ...(e.to_tag
            ? [{ title: "Rolled back to", value: e.to_tag, short: true }]
            : []),
          ...(e.namespace
            ? [{ title: "Namespace", value: e.namespace, short: true }]
            : []),
          { title: "Source", value: e.source, short: true },
          { title: "Details", value: e.message, short: false },
        ],
        footer: "BackTrack",
        ts: Math.floor(new Date(e.triggered_at).getTime() / 1000),
      },
    ],
  });
}

// ── Internal send helpers ─────────────────────────────────────────────────────

async function dispatchEmail(
  subject: string,
  text: string,
  html: string,
  to: string[],
  cfg: ChannelEmail,
): Promise<void> {
  if (process.env.BACKTRACK_RESEND_API_KEY) {
    const resend = new Resend(process.env.BACKTRACK_RESEND_API_KEY);
    const from =
      process.env.BACKTRACK_RESEND_FROM ?? "BackTrack <onboarding@resend.dev>";
    await resend.emails.send({ from, to, subject, text, html });
  } else if (cfg.host) {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    await transporter.sendMail({
      from: cfg.from || cfg.user,
      to: to.join(", "),
      subject,
      text,
      html,
    });
  }
}

async function sendWebhook(
  e: RollbackEvent,
  cfg: ChannelWebhook,
): Promise<void> {
  if (!cfg.enabled || !cfg.url) return;
  const isSlack =
    cfg.url.includes("hooks.slack.com") ||
    cfg.url.includes("discord.com/api/webhooks");
  await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: isSlack
      ? formatSlack(e)
      : JSON.stringify({ event: "backtrack.rollback", ...e }),
    signal: AbortSignal.timeout(5_000),
  });
}

async function sendTelegram(
  e: RollbackEvent,
  cfg: ChannelTelegram,
): Promise<void> {
  if (!cfg.enabled || !cfg.token || !cfg.chatId) return;
  await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: cfg.chatId, text: formatRollbackText(e) }),
    signal: AbortSignal.timeout(8_000),
  });
}

async function sendEmail(e: RollbackEvent, cfg: ChannelEmail): Promise<void> {
  if (!cfg.enabled || !cfg.to) return;
  const to = cfg.to
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!to.length) return;
  const subject = e.success
    ? `[BackTrack] ✅ Rollback succeeded — ${e.service}`
    : `[BackTrack] ❌ Rollback failed — ${e.service}`;
  await dispatchEmail(
    subject,
    formatRollbackText(e),
    formatRollbackHtml(e),
    to,
    cfg,
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function notifyRollback(
  event: RollbackEvent,
  configOverride?: NotificationConfig,
): Promise<void> {
  const cfg = configOverride ?? loadNotificationConfig();
  await Promise.allSettled([
    sendWebhook(event, cfg.webhook),
    sendTelegram(event, cfg.telegram),
    sendEmail(event, cfg.email),
  ]);
}

export async function sendConnectionConfirmation(
  cfg: ChannelEmail,
): Promise<void> {
  const to = cfg.to
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!to.length) return;
  const timestamp = fmtTs(new Date().toISOString());
  const subject = "BackTrack — Email Notifications Active";
  await dispatchEmail(
    subject,
    formatConnectionSuccessText(to.join(", "), timestamp),
    formatConnectionSuccessHtml(to.join(", "), timestamp),
    to,
    cfg,
  );
}

/** Returns which email provider is active, for UI display. */
export function emailProvider(): "resend" | "smtp" | "none" {
  if (process.env.BACKTRACK_RESEND_API_KEY) return "resend";
  if (process.env.BACKTRACK_SMTP_HOST && process.env.BACKTRACK_SMTP_USER)
    return "smtp";
  return "none";
}

// Re-export for callers that imported these from notifier previously
export { fmtTs, fmtMttr };
