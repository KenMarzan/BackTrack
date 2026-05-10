import { NextRequest, NextResponse } from "next/server";
import { loadNotificationConfig, notifyRollback } from "@/lib/notifier";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const channel = (body.channel ?? "all") as "webhook" | "telegram" | "email" | "all";
  const cfg = loadNotificationConfig();

  const testEvent = {
    service: "test-service",
    namespace: "default",
    platform: "kubernetes",
    to_tag: "v1.2.3",
    success: true,
    message: "This is a test notification from BackTrack.",
    triggered_at: new Date().toISOString(),
    source: "manual" as const,
  };

  // Disable channels not being tested
  const testCfg = {
    webhook:  { ...cfg.webhook,  enabled: channel === "all" || channel === "webhook"  ? cfg.webhook.enabled  : false },
    telegram: { ...cfg.telegram, enabled: channel === "all" || channel === "telegram" ? cfg.telegram.enabled : false },
    email:    { ...cfg.email,    enabled: channel === "all" || channel === "email"    ? cfg.email.enabled    : false },
  };

  const results = await Promise.allSettled([
    testCfg.webhook.enabled  ? fetch(testCfg.webhook.url!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "backtrack.test", ...testEvent }), signal: AbortSignal.timeout(5_000) }).then(() => "ok").catch(e => String(e)) : Promise.resolve("disabled"),
    testCfg.telegram.enabled ? fetch(`https://api.telegram.org/bot${testCfg.telegram.token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: testCfg.telegram.chatId, text: `[BackTrack Test] ✅ Test notification from BackTrack.\nService: ${testEvent.service}\nTime: ${testEvent.triggered_at}` }), signal: AbortSignal.timeout(8_000) }).then(r => r.ok ? "ok" : `HTTP ${r.status}`).catch(e => String(e)) : Promise.resolve("disabled"),
  ]);

  // For email use the full notifyRollback path
  let emailResult = "disabled";
  if (testCfg.email.enabled) {
    try {
      await notifyRollback(testEvent, { ...testCfg, webhook: { ...testCfg.webhook, enabled: false }, telegram: { ...testCfg.telegram, enabled: false } });
      emailResult = "ok";
    } catch (e) {
      emailResult = String(e);
    }
  }

  return NextResponse.json({
    ok: true,
    results: {
      webhook:  results[0].status === "fulfilled" ? results[0].value : String((results[0] as PromiseRejectedResult).reason),
      telegram: results[1].status === "fulfilled" ? results[1].value : String((results[1] as PromiseRejectedResult).reason),
      email:    emailResult,
    },
  });
}
