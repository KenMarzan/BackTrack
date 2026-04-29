import { NextRequest, NextResponse } from "next/server";
import { addDetectionEntry, clearDetectionEntries, listDetectionEntries } from "@/lib/metrics-store";

function computeMatrix(entries: ReturnType<typeof listDetectionEntries>) {
  const tsd = { tp: 0, fp: 0, tn: 0, fn: 0 };
  const lsi = { tp: 0, fp: 0, tn: 0, fn: 0 };

  for (const e of entries) {
    if (e.fault_injected) {
      e.tsd_detected ? tsd.tp++ : tsd.fn++;
      e.lsi_detected ? lsi.tp++ : lsi.fn++;
    } else {
      e.tsd_detected ? tsd.fp++ : tsd.tn++;
      e.lsi_detected ? lsi.fp++ : lsi.tn++;
    }
  }

  const metrics = (m: typeof tsd) => {
    const precision = m.tp + m.fp > 0 ? m.tp / (m.tp + m.fp) : null;
    const recall = m.tp + m.fn > 0 ? m.tp / (m.tp + m.fn) : null;
    const f1 =
      precision !== null && recall !== null && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : null;
    const accuracy = m.tp + m.fp + m.tn + m.fn > 0
      ? (m.tp + m.tn) / (m.tp + m.fp + m.tn + m.fn)
      : null;
    return { ...m, precision, recall, f1, accuracy };
  };

  return { tsd: metrics(tsd), lsi: metrics(lsi) };
}

export async function GET() {
  const entries = listDetectionEntries();
  const matrix = computeMatrix(entries);
  return NextResponse.json({ entries, matrix });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (body.action === "clear") {
    clearDetectionEntries();
    return NextResponse.json({ ok: true });
  }

  const {
    test_label,
    fault_injected,
    fault_type,
    service,
    injected_at,
    tsd_detected,
    lsi_detected,
    detected_at,
    notes,
  } = body;

  if (test_label === undefined || fault_injected === undefined) {
    return NextResponse.json({ error: "test_label and fault_injected are required." }, { status: 400 });
  }

  const detection_latency_seconds =
    detected_at && injected_at
      ? Math.round(
          (new Date(detected_at).getTime() - new Date(injected_at).getTime()) / 1000,
        )
      : null;

  const entry = addDetectionEntry({
    test_label,
    fault_injected: Boolean(fault_injected),
    fault_type: fault_type ?? "none",
    service,
    injected_at: injected_at ?? null,
    tsd_detected: Boolean(tsd_detected),
    lsi_detected: Boolean(lsi_detected),
    detected_at: detected_at ?? null,
    detection_latency_seconds,
    notes: notes ?? "",
  });

  return NextResponse.json({ ok: true, entry });
}
