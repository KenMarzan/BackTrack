/**
 * GitHub write-back after rollback.
 *
 * After BackTrack rolls back a deployment it:
 *   1. Posts a ❌ commit status on the bad SHA so the red mark appears next to
 *      that commit in the repo timeline.
 *   2. Creates a GitHub Deployment + Deployment Status (state=failure) so the
 *      event is visible in the repo's Deployments tab.
 *
 * Both steps are non-fatal — GitHub write-back must never block the rollback
 * response. All errors are swallowed internally.
 */

export type GitHubFlagParams = {
  repo: string;          // "owner/repo"
  token: string;         // GitHub PAT with repo + deployments scope
  sha?: string;          // commit SHA of the bad deployment (if known)
  branch?: string;       // branch to resolve latest SHA when sha not provided
  tag?: string;          // image tag that was rolled back (for display)
  service: string;       // service name
  reason: string;        // human-readable rollback reason
  environment?: string;  // deployment environment label (default: "production")
};

const GH_API = "https://api.github.com";

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghPost(url: string, token: string, body: object): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: ghHeaders(token),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return null;
  }
}

// Resolve the latest commit SHA on a branch when the caller doesn't have it.
async function resolveLatestSha(repo: string, token: string, branch: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${GH_API}/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`,
      { headers: ghHeaders(token), signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as Array<{ sha?: string }>;
    return data[0]?.sha ?? null;
  } catch {
    return null;
  }
}

export async function flagBadDeployment(params: GitHubFlagParams): Promise<void> {
  const {
    repo, token,
    sha: rawSha,
    branch = "main",
    tag, service, reason,
    environment = "production",
  } = params;

  if (!repo || !token) return;

  const description = `BackTrack rolled back ${service}${tag ? ` (${tag})` : ""}: ${reason}`.slice(0, 140);

  // Resolve SHA — use provided value or fall back to latest commit on branch
  const sha = rawSha || await resolveLatestSha(repo, token, branch);

  // ── Step 1: commit status ────────────────────────────────────────────────
  // Places a red ✗ next to the commit in the repo and on any open PR that
  // includes this SHA.
  if (sha) {
    await ghPost(`${GH_API}/repos/${repo}/statuses/${sha}`, token, {
      state: "failure",
      description,
      context: "backtrack/rollback",
      target_url: "http://localhost:3847",
    });
  }

  // ── Step 2: deployment + deployment status ───────────────────────────────
  // Creates a Deployment event in the repo's Deployments tab (visible to the
  // whole team) and marks it as failed with the rollback reason.
  const ref = sha ?? branch;
  const deployRes = await ghPost(`${GH_API}/repos/${repo}/deployments`, token, {
    ref,
    environment,
    description: `BackTrack detected anomaly on ${service}`,
    auto_merge: false,
    required_contexts: [],
  });

  if (deployRes?.ok) {
    const deployment = await deployRes.json() as { id?: number };
    if (deployment?.id) {
      await ghPost(
        `${GH_API}/repos/${repo}/deployments/${deployment.id}/statuses`,
        token,
        {
          state: "failure",
          description,
          environment,
          log_url: "http://localhost:3847",
        },
      );
    }
  }
}
