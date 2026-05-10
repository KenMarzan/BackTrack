import { NextRequest, NextResponse } from "next/server";
import { listConnections } from "@/lib/monitoring-store";
import { flagBadDeployment } from "@/lib/github-status";

// Called by the agent after an auto-rollback so the bad deployment is flagged
// in GitHub without the agent needing direct access to GitHub credentials.
// Body: { service, reason, tag?, sha? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      service?: string;
      reason?: string;
      tag?: string;
      sha?: string;
    };

    const service = (body.service ?? "").trim();
    const reason  = (body.reason  ?? "Auto-rollback triggered by BackTrack").trim();

    if (!service) {
      return NextResponse.json({ error: "service is required." }, { status: 400 });
    }

    // Find a connection that has GitHub credentials configured
    const connections = listConnections();
    const conn = connections.find((c) => c.githubRepo && c.githubToken) ?? connections[0];

    if (!conn?.githubRepo || !conn?.githubToken) {
      return NextResponse.json({ ok: false, message: "No GitHub credentials configured on any connection." });
    }

    await flagBadDeployment({
      repo:    conn.githubRepo,
      token:   conn.githubToken,
      branch:  conn.githubBranch ?? "main",
      sha:     body.sha,
      tag:     body.tag,
      service,
      reason,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
