import { NextRequest, NextResponse } from "next/server";
import { loadNotificationConfig, sendConnectionConfirmation } from "@/lib/notifier";

export async function POST(req: NextRequest) {
  const body    = await req.json().catch(() => ({}));
  const channel = (body.channel ?? "all") as "webhook" | "telegram" | "email" | "all";
  const cfg     = loadNotificationConfig();

  const testPayload = {
    event:   "backtrack.test",
    service: "api-gateway",
    message: "BackTrack connection test — all systems operational",
    ts:      new Date().toISOString(),
  };

  const results: Record<string, string> = {
    webhook:  "disabled",
    telegram: "disabled",
    email:    "disabled",
  };

  // ── Webhook ──────────────────────────────────────────────────────────────────
  if ((channel === "all" || channel === "webhook") && cfg.webhook.enabled && cfg.webhook.url) {
    try {
      const r = await fetch(cfg.webhook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(5_000),
      });
      results.webhook = r.ok ? "ok" : `HTTP ${r.status}`;
    } catch (e) {
      results.webhook = String(e);
    }
  }

  // ── Telegram ─────────────────────────────────────────────────────────────────
  if ((channel === "all" || channel === "telegram") && cfg.telegram.enabled && cfg.telegram.token && cfg.telegram.chatId) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${cfg.telegram.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: cfg.telegram.chatId,
          text: "[BackTrack Test] ✅ Connection confirmed — you will receive rollback alerts here.",
        }),
        signal: AbortSignal.timeout(8_000),
      });
      results.telegram = r.ok ? "ok" : `HTTP ${r.status}`;
    } catch (e) {
      results.telegram = String(e);
    }
  }

  // ── Email — send connection success confirmation ───────────────────────────
  if ((channel === "all" || channel === "email") && cfg.email.enabled && cfg.email.to) {
    try {
      await sendConnectionConfirmation(cfg.email);
      results.email = "ok";
    } catch (e) {
      results.email = String(e);
    }
  }

  return NextResponse.json({ ok: true, results });
}
