import { getContainerHealthMetrics } from "@/lib/prometheus";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const data = await getContainerHealthMetrics();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching container health metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch container health metrics" },
      { status: 500 },
    );
  }
}
