"""
GitHub feedback integration.

BackTrack NEVER modifies source code, branches, or PRs directly.
It only writes to:
  - Deployment Status API  (marks a deployment failed/success)
  - Commit Status API      (attaches a check to the SHA)
  - Issue comments API     (posts a summary comment on the associated PR)

All calls are fire-and-forget (logged on failure, never retried synchronously)
and are skipped cleanly when GITHUB_TOKEN or GITHUB_REPO are not set.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("backtrack.github")

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO = os.getenv("GITHUB_REPO", "")   # "owner/repo"
BACKTRACK_URL = os.getenv("BACKTRACK_PUBLIC_URL", "")
BASE = "https://api.github.com"


def _headers() -> dict:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _enabled() -> bool:
    return bool(GITHUB_TOKEN and GITHUB_REPO)


async def mark_deployment_in_progress(deployment_id: str | int) -> None:
    if not _enabled():
        return
    payload = {
        "state": "in_progress",
        "description": "BackTrack monitoring window active.",
        "environment": "production",
        "auto_inactive": False,
    }
    await _post_deployment_status(deployment_id, payload)


async def mark_deployment_success(deployment_id: str | int, service: str) -> None:
    if not _enabled():
        return
    payload = {
        "state": "success",
        "description": f"BackTrack: {service} passed monitoring window.",
        "log_url": BACKTRACK_URL or None,
        "environment": "production",
        "auto_inactive": True,
    }
    await _post_deployment_status(deployment_id, payload)


async def mark_deployment_failed(
    deployment_id: str | int,
    reason: str,
    anomaly_summary: Optional[dict] = None,
) -> None:
    if not _enabled():
        return
    description = f"BackTrack rollback: {reason}"[:140]
    payload = {
        "state": "failure",
        "description": description,
        "log_url": f"{BACKTRACK_URL}/rollback/history" if BACKTRACK_URL else None,
        "environment": "production",
        "auto_inactive": True,
    }
    await _post_deployment_status(deployment_id, payload)


async def set_commit_status(
    commit_sha: str,
    state: str,                        # "pending" | "success" | "failure" | "error"
    description: str,
    context: str = "backtrack/rollback",
) -> None:
    if not _enabled() or not commit_sha:
        return
    payload = {
        "state": state,
        "description": description[:140],
        "context": context,
        "target_url": BACKTRACK_URL or None,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{BASE}/repos/{GITHUB_REPO}/statuses/{commit_sha}",
                headers=_headers(),
                json={k: v for k, v in payload.items() if v is not None},
            )
            if r.status_code not in (200, 201):
                logger.warning("GitHub commit status update failed (%d): %s", r.status_code, r.text[:200])
    except Exception:
        logger.warning("GitHub commit status call failed", exc_info=True)


async def post_rollback_pr_comment(
    commit_sha: str,
    service: str,
    environment: str,
    from_image: str,
    to_image: str,
    reason: str,
    anomaly_summary: Optional[dict] = None,
    rollback_url: str = "",
) -> None:
    """Post a structured rollback summary comment on any open PR containing commit_sha."""
    if not _enabled() or not commit_sha:
        return

    rows = ""
    if anomaly_summary:
        for metric, info in anomaly_summary.items():
            rows += (
                f"| {metric} | {info.get('current', 'N/A')} "
                f"| {info.get('baseline', 'N/A')} "
                f"| {info.get('threshold', 'N/A')} |\n"
            )

    log_link = rollback_url or (f"{BACKTRACK_URL}/rollback/history" if BACKTRACK_URL else "")
    body = f"""## BackTrack Auto-Rollback

**Service:** `{service}` | **Environment:** `{environment}`
**From:** `{from_image}`
**To:** `{to_image}` (last stable)
**Reason:** {reason}
"""
    if rows:
        body += f"""
### Anomalies Detected
| Metric | Current | Baseline | Threshold |
|--------|---------|----------|-----------|
{rows}"""

    if log_link:
        body += f"\n[View rollback history]({log_link})"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            search = await client.get(
                f"{BASE}/search/issues",
                headers=_headers(),
                params={"q": f"repo:{GITHUB_REPO} is:pr {commit_sha}", "per_page": "5"},
            )
            if search.status_code != 200:
                return
            for item in search.json().get("items", []):
                pr_number = item["number"]
                await client.post(
                    f"{BASE}/repos/{GITHUB_REPO}/issues/{pr_number}/comments",
                    headers=_headers(),
                    json={"body": body},
                )
    except Exception:
        logger.warning("GitHub PR comment failed for %s/%s", commit_sha, service, exc_info=True)


async def _post_deployment_status(deployment_id: str | int, payload: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{BASE}/repos/{GITHUB_REPO}/deployments/{deployment_id}/statuses",
                headers=_headers(),
                json={k: v for k, v in payload.items() if v is not None},
            )
            if r.status_code not in (200, 201):
                logger.warning(
                    "GitHub deployment status update failed (%d): %s",
                    r.status_code, r.text[:200],
                )
    except Exception:
        logger.warning("GitHub deployment status call failed", exc_info=True)
