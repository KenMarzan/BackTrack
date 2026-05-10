import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import type { NotificationConfig } from "@/lib/notifier";
import { loadNotificationConfig, emailProvider } from "@/lib/notifier";

const DATA_DIR = path.join(process.cwd(), ".backtrack");
const FILE = path.join(DATA_DIR, "notifications.json");

function readRaw(): Partial<NotificationConfig> {
  try {
    if (!fs.existsSync(FILE)) return {};
    return JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch { return {}; }
}

function mask(s: string): string {
  return s ? "•".repeat(Math.min(s.length, 12)) : "";
}

export async function GET() {
  const cfg = loadNotificationConfig();
  return NextResponse.json({
    webhook:       cfg.webhook,
    telegram:      { ...cfg.telegram, token: mask(cfg.telegram.token) },
    email:         { ...cfg.email,    pass:  mask(cfg.email.pass) },
    emailProvider: emailProvider(),
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json() as Partial<NotificationConfig>;
  const current = readRaw();

  const updated: NotificationConfig = {
    webhook: { ...loadNotificationConfig().webhook,  ...(body.webhook  ?? {}) },
    telegram: { ...loadNotificationConfig().telegram, ...(body.telegram ?? {}) },
    email:    { ...loadNotificationConfig().email,    ...(body.email    ?? {}) },
  };

  // Never overwrite a real secret with the masked placeholder
  if (body.telegram?.token  && /^•+$/.test(body.telegram.token))  updated.telegram.token = (current as NotificationConfig)?.telegram?.token ?? "";
  if (body.email?.pass      && /^•+$/.test(body.email.pass))       updated.email.pass     = (current as NotificationConfig)?.email?.pass     ?? "";

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
  fs.renameSync(tmp, FILE);

  return NextResponse.json({ ok: true });
}
