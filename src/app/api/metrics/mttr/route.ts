import { NextRequest, NextResponse } from "next/server";
import { addMttrEntry, clearMttrEntries, listMttrEntries } from "@/lib/metrics-store";

export async function GET() {
  const entries = listMttrEntries();
  const count = entries.length;
  const successful = entries.filter((e) => e.success);
  const avg = successful.length
    ? successful.reduce((s, e) => s + e.mttr_seconds, 0) / successful.length
    : null;
  const min = successful.length ? Math.min(...successful.map((e) => e.mttr_seconds)) : null;
  const max = successful.length ? Math.max(...successful.map((e) => e.mttr_seconds)) : null;

  return NextResponse.json({ entries, stats: { count, avg, min, max } });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (body.action === "clear") {
    clearMttrEntries();
    return NextResponse.json({ ok: true });
  }

  const {
    service,
    connectionId,
    anomaly_type,
    anomaly_detected_at,
    rollback_triggered_at,
    rollback_completed_at,
    success,
  } = body;

  if (!service || !anomaly_detected_at || !rollback_triggered_at || !rollback_completed_at) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const mttr_seconds = Math.round(
    (new Date(rollback_completed_at).getTime() - new Date(anomaly_detected_at).getTime()) / 1000,
  );

  const entry = addMttrEntry({
    service,
    connectionId,
    anomaly_type: anomaly_type ?? "MANUAL",
    anomaly_detected_at,
    rollback_triggered_at,
    rollback_completed_at,
    mttr_seconds,
    success: success ?? true,
  });

  return NextResponse.json({ ok: true, entry });
}
