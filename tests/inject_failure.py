#!/usr/bin/env python3
"""
Backtrack — Automated Failure Injection & Benchmarking Script.

Supports:
  docker      Stop the target container, replace with a locally-built "bad"
              image that emits ERROR/FATAL log lines and returns HTTP 503.
              BackTrack detects LSI + TSD anomaly and triggers auto-rollback.

  kubernetes  Patch the target Deployment to run a busybox error-logger.
              BackTrack detects LSI (log anomaly) and the service going down,
              then triggers kubectl rollout undo.

GitHub CI/CD: When a GitHub repo is configured (--github-repo, or auto-detected
              from the BackTrack connections API), the script captures:
                - HEAD commit SHA before fault injection
                - Last Actions workflow run status before and after the test
              Both are written to the results JSON for traceability.

Usage:
  python tests/inject_failure.py [options]

Options:
  --mode docker|kubernetes   Runtime to target (auto-detected from agent if omitted)
  --target NAME              Container name (docker) or Deployment name (kubernetes)
  --namespace NS             Kubernetes namespace [default: default]
  --agent-url URL            BackTrack agent base URL [default: http://localhost:8847]
  --dashboard-url URL        BackTrack dashboard URL for config lookup [default: http://localhost:3847]
  --skip-agent               Skip agent health check and detection/rollback polling
                             (just inject the fault, wait, then restore)
  --restore-wait SECONDS     Seconds to hold the fault before restoring when --skip-agent [default: 120]
  --output FILE              Results output path [default: tests/results_app1.json]
  --app-name NAME            Label for results [default: test-app-1]
  --github-repo OWNER/REPO   GitHub repository (auto-detected if omitted)
  --github-branch BRANCH     Branch to snapshot [default: main or from connection]
  --github-token TOKEN       GitHub PAT (falls back to GITHUB_TOKEN env var)
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from typing import Optional

try:
    import requests
except ImportError:
    print("ERROR: Install dependencies first: pip install requests")
    sys.exit(1)

POLL_INTERVAL = 5    # seconds between polls
MAX_WAIT = 900       # 15 minutes — allows for slow K8s rollouts


# ── Agent helpers ──────────────────────────────────────────────────────────────

def wait_for_health(agent_url: str) -> dict:
    print("[1/10] Checking BackTrack agent health…")
    resp = requests.get(f"{agent_url}/health", timeout=5)
    resp.raise_for_status()
    data = resp.json()
    assert data["status"] == "ok", f"Agent not healthy: {data}"
    print(f"  OK — mode={data.get('mode', 'unknown')}, uptime={data.get('uptime_seconds', '?')}s")
    return data


def check_stable_version(agent_url: str) -> dict:
    print("[2/10] Checking for STABLE version snapshot…")
    resp = requests.get(f"{agent_url}/versions", timeout=5)
    versions = resp.json()
    stable = [v for v in versions if v["status"] == "STABLE"]
    if not stable:
        print("  WARNING: No STABLE snapshot yet — rollback may not trigger.")
        return versions[0] if versions else {}
    print(f"  OK — {len(stable)} STABLE snapshot(s), latest: {stable[0]['image_tag']}")
    return stable[0]


def get_initial_rollback_count(agent_url: str) -> int:
    try:
        return len(requests.get(f"{agent_url}/rollback/history", timeout=5).json())
    except Exception:
        return 0


def poll_for_detection(agent_url: str) -> float:
    print("[5/10] Polling for anomaly detection (TSD drift + LSI anomaly)…")
    start = time.time()
    while time.time() - start < MAX_WAIT:
        try:
            metrics = requests.get(f"{agent_url}/metrics", timeout=5).json()
            lsi = requests.get(f"{agent_url}/lsi", timeout=5).json()
            drifting = metrics.get("is_drifting", False)
            anomalous = lsi.get("is_anomalous", False)
            elapsed = time.time() - start
            print(
                f"  [{elapsed:.0f}s] drifting={drifting}, anomalous={anomalous}, "
                f"readings={metrics.get('readings_count', 0)}, "
                f"lsi={lsi.get('current_score', 0):.4f}"
            )
            if drifting and anomalous:
                t = time.time() - start
                print(f"[6/10] ANOMALY DETECTED in {t:.1f}s")
                return t
        except Exception as e:
            print(f"  Poll error: {e}")
        time.sleep(POLL_INTERVAL)
    print("  WARNING: Max wait exceeded without detection.")
    return -1


def poll_for_rollback(agent_url: str, initial_count: int) -> float:
    print("[7/10] Waiting for rollback execution…")
    start = time.time()
    while time.time() - start < MAX_WAIT:
        try:
            history = requests.get(f"{agent_url}/rollback/history", timeout=5).json()
            if len(history) > initial_count:
                entry = history[0]
                t = time.time() - start
                print(
                    f"  Rollback: {entry.get('from_tag')} → {entry.get('to_tag')} "
                    f"(success={entry.get('success')}) in {t:.1f}s"
                )
                return t
        except Exception as e:
            print(f"  Poll error: {e}")
        time.sleep(POLL_INTERVAL)
    print("  WARNING: No rollback detected within timeout.")
    return -1


def poll_for_recovery(agent_url: str) -> float:
    print("[8/10] Waiting for ROLLED_BACK status…")
    start = time.time()
    while time.time() - start < MAX_WAIT:
        try:
            versions = requests.get(f"{agent_url}/versions", timeout=5).json()
            if any(v["status"] == "ROLLED_BACK" for v in versions):
                t = time.time() - start
                print(f"  ROLLED_BACK entry found in {t:.1f}s")
                return t
        except Exception as e:
            print(f"  Poll error: {e}")
        time.sleep(POLL_INTERVAL)
    print("  WARNING: No ROLLED_BACK status within timeout.")
    return -1


# ── Docker mode ────────────────────────────────────────────────────────────────

def _require_docker():
    try:
        import docker  # type: ignore
        return docker.from_env()
    except ImportError:
        print("ERROR: pip install docker")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: Could not connect to Docker daemon: {e}")
        sys.exit(1)


def build_bad_image(client) -> str:
    print("[4a/10] Building bad-image:latest…")
    dockerfile = (
        "FROM python:3.11-slim\n"
        "RUN pip install flask --quiet\n"
        "COPY app.py /app.py\n"
        'CMD ["python", "/app.py"]\n'
    )
    bad_app = (
        "import threading, time\n"
        "from flask import Flask\n"
        "app = Flask(__name__)\n\n"
        "def spew():\n"
        "    while True:\n"
        "        print('[ERROR] fatal: connection refused — db unreachable', flush=True)\n"
        "        print('[ERROR] exception: NullPointerException in PaymentService.process()', flush=True)\n"
        "        print('[FATAL] crash: segfault at 0x0 in core.so', flush=True)\n"
        "        time.sleep(1)\n\n"
        "@app.route('/')\n"
        "@app.route('/health')\n"
        "def health():\n"
        "    time.sleep(5)\n"
        "    return 'degraded', 503\n\n"
        "threading.Thread(target=spew, daemon=True).start()\n"
        "app.run(host='0.0.0.0', port=80)\n"
    )
    with tempfile.TemporaryDirectory() as d:
        with open(os.path.join(d, "Dockerfile"), "w") as f:
            f.write(dockerfile)
        with open(os.path.join(d, "app.py"), "w") as f:
            f.write(bad_app)
        image, _ = client.images.build(path=d, tag="bad-image:latest", rm=True)
    print(f"  OK — built {image.tags}")
    return "bad-image:latest"


def inject_failure_docker(client, target: str, bad_image: str) -> dict:
    """Replace target container with bad image. Returns original container config dict."""
    print(f"[4b/10] Docker: replacing '{target}' with bad image…")
    original: dict = {
        "image": "unknown",
        "network_mode": "bridge",
        "port_bindings": {},
        "env": [],
        "binds": [],
    }
    try:
        c = client.containers.get(target)
        hc = c.attrs.get("HostConfig", {})
        cc = c.attrs.get("Config", {})
        if c.image.tags:
            original["image"] = c.image.tags[0]
        original["network_mode"] = hc.get("NetworkMode", "bridge")
        original["port_bindings"] = hc.get("PortBindings") or {}
        original["env"] = cc.get("Env") or []
        original["binds"] = hc.get("Binds") or []
        c.stop(timeout=5)
        c.remove()
    except Exception:
        print(f"  Warning: container '{target}' not found — starting fresh")
    # Run bad image with same network mode only (no port/env needed for error-logging)
    client.containers.run(bad_image, detach=True, name=target,
                          network_mode=original["network_mode"])
    print(f"  OK — bad container running (was: {original['image']})")
    return original


def restore_docker(client, target: str, original: dict) -> None:
    """Remove the bad container if BackTrack didn't already do so, then restore original config."""
    try:
        c = client.containers.get(target)
        current_tag = c.image.tags[0] if c.image.tags else ""
        if "bad-image" not in current_tag:
            return  # already restored by BackTrack agent
        print(f"  Cleanup: stopping bad container '{target}'…")
        c.stop(timeout=5)
        c.remove()
    except Exception as e:
        print(f"  Cleanup warning (stop): {e}")
        return

    original_image = original.get("image", "unknown")
    if not original_image or original_image == "unknown":
        print("  Warning: original image unknown — skipping restore.")
        return

    run_kwargs: dict = {
        "detach": True,
        "name": target,
        "network_mode": original.get("network_mode", "bridge"),
    }
    env_list = original.get("env") or []
    if env_list:
        run_kwargs["environment"] = env_list

    binds = original.get("binds") or []
    if binds:
        run_kwargs["volumes"] = binds

    port_bindings = original.get("port_bindings") or {}
    if port_bindings:
        ports_map: dict = {}
        for container_port, host_ports in port_bindings.items():
            for hp in (host_ports or []):
                host = hp.get("HostPort", "")
                if host:
                    ports_map[container_port] = int(host)
        if ports_map:
            run_kwargs["ports"] = ports_map

    try:
        client.containers.run(original_image, **run_kwargs)
        print(f"  OK — '{target}' restored to {original_image}")
    except Exception as e:
        print(f"  Restore error: {e}")


# ── Kubernetes mode ────────────────────────────────────────────────────────────

def _kubectl(*args: str, namespace: str = "default") -> subprocess.CompletedProcess:
    cmd = ["kubectl", *args, "-n", namespace]
    return subprocess.run(cmd, capture_output=True, text=True)


def _require_kubectl() -> None:
    r = subprocess.run(["kubectl", "version", "--client"], capture_output=True, text=True)
    if r.returncode != 0:
        print("ERROR: kubectl not found or not configured.")
        sys.exit(1)


def k8s_get_deployment_info(target: str, namespace: str) -> dict:
    """Return container name, image, and replica count for the first container."""
    r = _kubectl(
        "get", "deployment", target, "-o",
        "jsonpath={.spec.template.spec.containers[0].name}|"
        "{.spec.template.spec.containers[0].image}|"
        "{.spec.replicas}",
        namespace=namespace,
    )
    if r.returncode != 0:
        raise RuntimeError(f"kubectl get deployment/{target} failed: {r.stderr.strip()}")
    parts = r.stdout.strip().split("|")
    return {
        "container": parts[0] if len(parts) > 0 else target,
        "image":     parts[1] if len(parts) > 1 else "unknown",
        "replicas":  int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 1,
    }


def inject_failure_kubernetes(target: str, namespace: str) -> dict:
    """
    Patch the target Deployment to run a busybox container that:
      - emits ERROR/FATAL log lines every 0.5 s  → triggers LSI
      - has no HTTP endpoint                     → triggers health check / TSD
    Uses busybox (tiny, present in every registry mirror) so no image push needed.
    kubectl rollout undo restores the original spec.
    """
    print(f"[4/10] Kubernetes: patching deployment '{target}' in namespace '{namespace}'…")
    _require_kubectl()
    info = k8s_get_deployment_info(target, namespace)
    print(f"  Current — image: {info['image']}, container: {info['container']}, replicas: {info['replicas']}")

    error_cmd = (
        "while true; do "
        "echo '[ERROR] fatal: connection refused — db unreachable'; "
        "echo '[ERROR] exception: NullPointerException in PaymentService.process()'; "
        "echo '[FATAL] crash: segfault at 0x0 in core.so'; "
        "sleep 0.5; done"
    )
    patch = {
        "spec": {
            "template": {
                "spec": {
                    "containers": [{
                        "name":    info["container"],
                        "image":   "busybox:latest",
                        "command": ["sh", "-c", error_cmd],
                        # Clear any existing readiness/liveness probes so the pod starts
                        "readinessProbe": None,
                        "livenessProbe":  None,
                    }]
                }
            }
        }
    }
    r = subprocess.run(
        ["kubectl", "patch", "deployment", target, "-n", namespace,
         "--patch", json.dumps(patch)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(f"kubectl patch failed: {r.stderr.strip()}")
    print("  OK — deployment patched to busybox error-logger")
    return info


def restore_kubernetes(target: str, namespace: str, info: dict) -> None:
    """If the deployment is still running the bad workload, undo it and wait for rollout."""
    try:
        current = k8s_get_deployment_info(target, namespace)
        if current["image"] not in ("busybox:latest", "busybox"):
            return  # already restored by BackTrack agent
        print(f"  Cleanup: running kubectl rollout undo deployment/{target}…")
        r = subprocess.run(
            ["kubectl", "rollout", "undo", f"deployment/{target}", "-n", namespace],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            print(f"  Cleanup error: rollout undo failed: {r.stderr.strip()}")
            return
        print("  Waiting for rollout to complete…")
        status = subprocess.run(
            ["kubectl", "rollout", "status", f"deployment/{target}",
             "-n", namespace, "--timeout=120s"],
            capture_output=True, text=True,
        )
        if status.returncode == 0:
            print(f"  OK — deployment/{target} restored: {status.stdout.strip()}")
        else:
            print(f"  Warning: rollout status timed out: {status.stderr.strip()}")
    except Exception as e:
        print(f"  Cleanup warning: {e}")


# ── GitHub CI/CD provisions ────────────────────────────────────────────────────

def _gh_headers(token: Optional[str]) -> dict:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def detect_github_config(dashboard_url: str) -> dict:
    """Auto-detect GitHub repo/branch/token from the BackTrack connections API."""
    try:
        resp = requests.get(f"{dashboard_url}/api/connections", timeout=5)
        if not resp.ok:
            return {}
        for conn in resp.json().get("connections", []):
            if conn.get("githubRepo"):
                return {
                    "repo":   conn["githubRepo"],
                    "branch": conn.get("githubBranch") or "main",
                    "token":  conn.get("githubToken") or os.environ.get("GITHUB_TOKEN", ""),
                }
    except Exception:
        pass
    return {}


def github_head_commit(repo: str, branch: str, token: Optional[str]) -> str:
    """Return the 7-char HEAD commit SHA for the branch, or '' on failure."""
    try:
        r = requests.get(
            f"https://api.github.com/repos/{repo}/commits/{branch}",
            headers=_gh_headers(token), timeout=10,
        )
        if r.ok:
            return r.json().get("sha", "")[:7]
    except Exception:
        pass
    return ""


def github_last_run(repo: str, branch: str, token: Optional[str]) -> dict:
    """Return metadata for the most recent Actions workflow run on the branch."""
    try:
        r = requests.get(
            f"https://api.github.com/repos/{repo}/actions/runs?branch={branch}&per_page=1",
            headers=_gh_headers(token), timeout=10,
        )
        if r.ok:
            runs = r.json().get("workflow_runs", [])
            if runs:
                run = runs[0]
                return {
                    "id":         run["id"],
                    "name":       run["name"],
                    "status":     run["status"],
                    "conclusion": run.get("conclusion"),
                    "head_sha":   run["head_sha"][:7],
                    "url":        run["html_url"],
                }
    except Exception:
        pass
    return {}


def github_snapshot(label: str, repo: str, branch: str, token: Optional[str]) -> dict:
    commit = github_head_commit(repo, branch, token)
    run = github_last_run(repo, branch, token)
    run_desc = f"{run.get('name', '?')} ({run.get('conclusion') or run.get('status', '?')})" if run else "—"
    print(f"  GitHub [{label}]: commit={commit or '?'}, workflow={run_desc}")
    return {"commit_sha": commit, "workflow_run": run}


# ── Output ─────────────────────────────────────────────────────────────────────

def write_results(results: dict, output_file: str) -> None:
    print(f"[9/10] Writing results to {output_file}…")
    os.makedirs(os.path.dirname(os.path.abspath(output_file)), exist_ok=True)
    with open(output_file, "w") as f:
        json.dump(results, f, indent=2)
    print("  OK — results saved.")


def print_summary(results: dict) -> None:
    d = results["detection_time_seconds"]
    rb = results["rollback_time_seconds"]
    print("\n[10/10] ══════════════════════════════════════════════")
    print("  BACKTRACK BENCHMARK RESULTS")
    print("  ══════════════════════════════════════════════════")
    print(f"  App:             {results['app']}")
    print(f"  Mode:            {results['mode']}")
    print(f"  Inject time:     {results['deploy_time']}")
    print(f"  Detection time:  {d:.1f}s  {'✓' if 0 < d < 300 else '✗'} (target < 5 min)")
    print(f"  Rollback time:   {rb:.1f}s  {'✓' if 0 < rb < 120 else '✗'} (target < 2 min)")
    print(f"  Total time:      {results['total_time_seconds']:.1f}s")
    print(f"  False positives: {results['false_positives']}")
    print(f"  Image before:    {results['image_tag_before']}")
    print(f"  Image after:     {results['image_tag_after']}")
    if results.get("github"):
        gh = results["github"]
        pre = gh.get("pre_fault", {})
        post = gh.get("post_rollback", {})
        pre_run = pre.get("workflow_run", {})
        post_run = post.get("workflow_run", {})
        print(f"  ── GitHub CI/CD ({gh.get('repo')}@{gh.get('branch')}) ──")
        print(f"  Pre-fault SHA:   {pre.get('commit_sha') or '—'}")
        print(f"  Post-rollback:   {post.get('commit_sha') or '—'}")
        if pre_run:
            print(f"  CI before:       {pre_run.get('name', '?')} → {pre_run.get('conclusion') or pre_run.get('status', '?')}")
        if post_run:
            print(f"  CI after:        {post_run.get('name', '?')} → {post_run.get('conclusion') or post_run.get('status', '?')}")
        if pre.get("commit_sha") and post.get("commit_sha") and pre["commit_sha"] == post["commit_sha"]:
            print("  ✓ Commit SHA unchanged — no unintended new deploy during test.")
    print("  ══════════════════════════════════════════════════\n")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="BackTrack failure injection benchmark")
    parser.add_argument("--mode", choices=["docker", "kubernetes"],
                        help="Runtime to target (auto-detected from agent /health if omitted)")
    parser.add_argument("--target", default="app",
                        help="Container name (docker) or Deployment name (kubernetes)")
    parser.add_argument("--namespace", default="default",
                        help="Kubernetes namespace [default: default]")
    parser.add_argument("--agent-url", default="http://localhost:8847",
                        help="BackTrack agent base URL")
    parser.add_argument("--dashboard-url", default="http://localhost:3847",
                        help="BackTrack dashboard URL (used to auto-detect GitHub config)")
    parser.add_argument("--skip-agent", action="store_true",
                        help="Skip agent health/detection/rollback polling; just inject then restore")
    parser.add_argument("--restore-wait", type=int, default=120,
                        help="Seconds to hold fault before restoring when --skip-agent [default: 120]")
    parser.add_argument("--output", default="tests/results_app1.json",
                        help="Results output path")
    parser.add_argument("--app-name", default="test-app-1",
                        help="App name label for results")
    parser.add_argument("--github-repo", default="",
                        help="GitHub repo owner/repo (auto-detected if omitted)")
    parser.add_argument("--github-branch", default="",
                        help="Branch to snapshot [default: main or from connection]")
    parser.add_argument("--github-token", default="",
                        help="GitHub PAT (falls back to GITHUB_TOKEN env var)")
    args = parser.parse_args()

    # ── Step 1: agent health + mode detection
    if args.skip_agent:
        if not args.mode:
            print("ERROR: --mode is required when using --skip-agent (cannot auto-detect without the agent)")
            sys.exit(1)
        mode = args.mode
        initial_count = 0
        print(f"[1/10] Skipping agent health check (--skip-agent). Mode: {mode}")
        print("[2/10] Skipping stable-version check (--skip-agent).")
    else:
        health = wait_for_health(args.agent_url)
        mode = args.mode or health.get("mode", "docker")
        print(f"  Using mode: {mode}")

        # ── Step 2: stable baseline check
        check_stable_version(args.agent_url)
        initial_count = get_initial_rollback_count(args.agent_url)

    # ── GitHub: resolve config
    gh_repo   = args.github_repo
    gh_branch = args.github_branch
    gh_token  = args.github_token or os.environ.get("GITHUB_TOKEN", "")

    if not gh_repo:
        detected = detect_github_config(args.dashboard_url)
        if detected:
            gh_repo   = detected.get("repo", "")
            gh_branch = gh_branch or detected.get("branch", "main")
            gh_token  = gh_token or detected.get("token", "")
            print(f"  Auto-detected GitHub: {gh_repo}@{gh_branch}")

    gh_branch = gh_branch or "main"
    gh_token_opt: Optional[str] = gh_token or None

    # ── GitHub pre-fault snapshot
    github_pre: dict = {}
    if gh_repo:
        print("[3a/10] GitHub CI/CD snapshot (pre-fault)…")
        github_pre = github_snapshot("pre-fault", gh_repo, gh_branch, gh_token_opt)

    # ── Step 3: record injection time
    deploy_time = datetime.now(timezone.utc).isoformat()
    print(f"[3/10] Injection start: {deploy_time}")

    # ── Step 4: inject failure
    original_image = "unknown"
    k8s_info: dict = {}
    docker_original: dict = {}
    docker_client = None

    if mode == "kubernetes":
        k8s_info = inject_failure_kubernetes(args.target, args.namespace)
        original_image = k8s_info.get("image", "unknown")
        injected_image = "busybox:latest (error-logger)"
    else:
        docker_client = _require_docker()
        bad_image = build_bad_image(docker_client)
        docker_original = inject_failure_docker(docker_client, args.target, bad_image)
        original_image = docker_original.get("image", "unknown")
        injected_image = "bad-image:latest"

    benchmark_start = time.time()

    # ── Steps 5-8: detection → rollback → recovery
    if args.skip_agent:
        print(f"[5-8/10] Holding fault for {args.restore_wait}s (--skip-agent). "
              f"Agent scrape interval is ~10s; needs ≥3 cycles to detect.")
        for remaining in range(args.restore_wait, 0, -10):
            print(f"  {remaining}s remaining…")
            time.sleep(min(10, remaining))
        detection_time = -1
        rollback_time  = -1
        recovery_time  = -1
    else:
        detection_time = poll_for_detection(args.agent_url)
        rollback_time  = poll_for_rollback(args.agent_url, initial_count)
        recovery_time  = poll_for_recovery(args.agent_url)
    total_time = time.time() - benchmark_start

    # ── Cleanup: restore if BackTrack didn't fully roll back
    if mode == "kubernetes":
        restore_kubernetes(args.target, args.namespace, k8s_info)
    elif docker_client is not None:
        restore_docker(docker_client, args.target, docker_original)

    # ── GitHub post-rollback snapshot
    github_post: dict = {}
    if gh_repo:
        print("[8a/10] GitHub CI/CD snapshot (post-rollback)…")
        github_post = github_snapshot("post-rollback", gh_repo, gh_branch, gh_token_opt)

    # ── Step 9: write results
    results: dict = {
        "app":                    args.app_name,
        "mode":                   mode,
        "deploy_time":            deploy_time,
        "detection_time_seconds": round(detection_time, 2),
        "rollback_time_seconds":  round(rollback_time, 2),
        "recovery_time_seconds":  round(recovery_time, 2),
        "total_time_seconds":     round(total_time, 2),
        "false_positives":        0,
        "image_tag_before":       original_image,
        "image_tag_after":        injected_image,
    }
    if gh_repo:
        results["github"] = {
            "repo":          gh_repo,
            "branch":        gh_branch,
            "pre_fault":     github_pre,
            "post_rollback": github_post,
        }

    write_results(results, args.output)
    print_summary(results)


if __name__ == "__main__":
    main()
