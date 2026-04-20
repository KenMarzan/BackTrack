import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/monitoring-store";
import { runCommand } from "@/lib/command";

type RollbackPayload = {
  connectionId?: string;
  service?: string;
  revision?: number;
};

const AGENT_URL = process.env.BACKTRACK_AGENT_URL || "http://localhost:9090";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as RollbackPayload;

    if (!payload.connectionId || !payload.service) {
      return NextResponse.json(
        { error: "connectionId and service are required." },
        { status: 400 },
      );
    }

    const connection = getConnection(payload.connectionId);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found." }, { status: 404 });
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

    const statusResult = await runCommand("kubectl", [
      "rollout",
      "status",
      `deployment/${payload.service}`,
      "-n",
      connection.namespace || "default",
      "--timeout=90s",
    ]);

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
