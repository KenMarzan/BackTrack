import { NextRequest, NextResponse } from "next/server";
import { notifyRollback, type RollbackEvent } from "@/lib/notifier";

export async function POST(req: NextRequest) {
  try {
    const event = (await req.json()) as RollbackEvent;
    if (!event.service || !event.platform) {
      return NextResponse.json({ error: "service and platform are required." }, { status: 400 });
    }
    await notifyRollback(event);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
