import { NextRequest, NextResponse } from "next/server";
import { removeConnection } from "@/lib/monitoring-store";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  const removed = removeConnection(id);
  if (!removed) {
    return NextResponse.json({ error: "Connection not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}
