import { NextRequest, NextResponse } from "next/server";
import { getConnection, findConnectionByNamespace } from "@/lib/monitoring-store";
import { runCommand } from "@/lib/command";
import { addMttrEntry } from "@/lib/metrics-store";

type RollbackPayload = {
  connectionId?: string;
  service?: string;
  namespace?: string;
  revision?: number;
  anomaly_detected_at?: string;
  anomaly_type?: "TSD" | "LSI" | "BOTH" | "MANUAL";
};

const AGENT_URL = process.env.BACKTRACK_AGENT_URL || "http://localhost:9090";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as RollbackPayload;

    if (!payload.service) {
      return NextResponse.json(
        { error: "service is required." },
        { status: 400 },
      );
    }

    const connection = payload.connectionId
      ? getConnection(payload.connectionId)
      : findConnectionByNamespace(payload.namespace ?? "default");

    if (!connection) {
      return NextResponse.json({ error: "No matching connection found. Register a cluster first." }, { status: 404 });
    }

    // Docker rollback: forward to backtrack-agent
    if (connection.platform === "docker") {
      try {
        const response = await fetch(`${AGENT_URL}/rollback/trigger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: `Dashboard rollback for ${payload.service}` }),
        });

        const agentResult = await response.json();

        if (!response.ok) {
          return NextResponse.json(
            { error: agentResult.message || "Agent rollback failed." },
            { status: 500 },
          );
        }

        return NextResponse.json({
          ok: true,
          message: "Docker rollback triggered via agent.",
          output: agentResult.message || "Rollback initiated.",
        });
      } catch {
        return NextResponse.json(
          { error: "Agent unreachable. Is backtrack-agent running?" },
          { status: 502 },
        );
      }
    }

    // Kubernetes rollback: kubectl rollout undo
    const args = [
      "rollout",
      "undo",
      `deployment/${payload.service}`,
      "-n",
      connection.namespace || "default",
    ];

    if (payload.revision && Number.isFinite(payload.revision)) {
      args.push(`--to-revision=${payload.revision}`);
    }

    const rollbackResult = await runCommand("kubectl", args);

    if (rollbackResult.code !== 0) {
      return NextResponse.json(
        { error: rollbackResult.stderr || "Rollback failed." },
        { status: 500 },
      );
    }

    const rollbackTriggeredAt = new Date().toISOString();

    const statusResult = await runCommand("kubectl", [
      "rollout",
      "status",
      `deployment/${payload.service}`,
      "-n",
      connection.namespace || "default",
      "--timeout=90s",
    ]);

    const rollbackCompletedAt = new Date().toISOString();
    const detectedAt = payload.anomaly_detected_at ?? rollbackTriggeredAt;

    addMttrEntry({
      service: payload.service,
      connectionId: payload.connectionId,
      anomaly_type: payload.anomaly_type ?? "MANUAL",
      anomaly_detected_at: detectedAt,
      rollback_triggered_at: rollbackTriggeredAt,
      rollback_completed_at: rollbackCompletedAt,
      mttr_seconds: Math.round(
        (new Date(rollbackCompletedAt).getTime() - new Date(detectedAt).getTime()) / 1000,
      ),
      success: statusResult.code === 0,
    });

    return NextResponse.json({
      ok: true,
      message: "Rollback executed.",
      output: rollbackResult.stdout,
      rolloutStatus: statusResult.stdout || statusResult.stderr,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
