import { detectAnomalies } from "@/lib/prometheus";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const anomalies = await detectAnomalies();
    return NextResponse.json(anomalies);
  } catch (error) {
    console.error("Error in anomalies route:", error);
    return NextResponse.json(
      { error: "Failed to fetch anomalies" },
      { status: 500 },
    );
  }
}
