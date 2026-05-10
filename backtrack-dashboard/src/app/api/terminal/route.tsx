import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";

// Allowed command prefixes — only read-only kubectl/docker diagnostics.
// Exec/attach/port-forward/cp and arbitrary shell commands are blocked.
const ALLOWED_PREFIXES = [
  "kubectl get",
  "kubectl describe",
  "kubectl logs",
  "kubectl rollout history",
  "kubectl rollout status",
  "kubectl top",
  "kubectl explain",
  "kubectl api-resources",
  "kubectl version",
  "docker ps",
  "docker logs",
  "docker stats",
  "docker inspect",
  "docker images",
  "docker version",
  "docker info",
];

function isAllowed(command: string): boolean {
  const trimmed = command.trim().replace(/\s+/g, " ");
  return ALLOWED_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export async function POST(request: NextRequest) {
  try {
    const { command } = await request.json();

    if (!command || typeof command !== "string") {
      return NextResponse.json({ error: "No command provided." }, { status: 400 });
    }

    if (!isAllowed(command)) {
      return NextResponse.json(
        { error: `Command not permitted. Allowed prefixes: ${ALLOWED_PREFIXES.join(", ")}` },
        { status: 403 },
      );
    }

    // Use spawn with shell:false — split on whitespace, no shell interpolation.
    const parts = command.trim().split(/\s+/);
    const output = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      const proc = spawn(parts[0], parts.slice(1), { shell: false });

      proc.stdout.on("data", (d: Buffer) => chunks.push(d));
      proc.stderr.on("data", (d: Buffer) => errChunks.push(d));
      proc.on("error", reject);
      proc.on("close", () =>
        resolve({
          stdout: Buffer.concat(chunks).toString("utf-8").slice(0, 1024 * 512),
          stderr: Buffer.concat(errChunks).toString("utf-8").slice(0, 64 * 1024),
        }),
      );

      // Hard timeout — kill if command hangs
      setTimeout(() => { proc.kill("SIGTERM"); }, 30_000);
    });

    return NextResponse.json({ output: output.stdout, error: output.stderr });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
