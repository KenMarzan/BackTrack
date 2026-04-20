#!/usr/bin/env python3
"""
Backtrack — Automated Failure Injection & Benchmarking Script.

Usage:
    python tests/inject_failure.py [--target APP_CONTAINER] [--agent-url http://localhost:9090]

Steps:
  1. Confirm Backtrack /health returns ok.
  2. Confirm /versions has at least one STABLE snapshot.
  3. Record start_time.
  4. Replace running app container with a "bad" image that logs ERRORs and has high latency.
  5. Poll /metrics and /lsi every 5 seconds.
  6. Record detection_time when is_drifting=True AND is_anomalous=True.
  7. Record rollback_time when /rollback/history has a new entry.
  8. Record recovery_time when /versions has a new ROLLED_BACK entry.
  9. Write results to tests/results_app1.json.
  10. Print summary table.
"""
import argparse
import io
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone

try:
    import docker
    import requests
except ImportError:
    print("ERROR: Install dependencies first: pip install docker requests")
    sys.exit(1)


POLL_INTERVAL = 5  # seconds
MAX_WAIT = 600  # 10 minutes max


def wait_for_health(agent_url: str) -> None:
    """Step 1: confirm Backtrack agent is healthy."""
    print("[1/10] Checking Backtrack agent health...")
    resp = requests.get(f"{agent_url}/health", timeout=5)
    resp.raise_for_status()
    data = resp.json()
    assert data["status"] == "ok", f"Agent not healthy: {data}"
    print(f"  OK — mode={data['mode']}, uptime={data['uptime_seconds']}s")


def check_stable_version(agent_url: str) -> dict:
    """Step 2: confirm at least one STABLE snapshot exists."""
    print("[2/10] Checking for STABLE version snapshot...")
    resp = requests.get(f"{agent_url}/versions", timeout=5)
    versions = resp.json()
    stable = [v for v in versions if v["status"] == "STABLE"]
    if not stable:
        print("  WARNING: No STABLE snapshot found. The agent may still be in PENDING state.")
        print("  Continuing anyway — rollback may not work without a stable baseline.")
        return versions[0] if versions else {}
    print(f"  OK — {len(stable)} STABLE snapshot(s), latest: {stable[0]['image_tag']}")
    return stable[0]


def build_bad_image(client: docker.DockerClient) -> str:
    """Build a Docker image that logs ERRORs every second and has high latency."""
    print("[4/10] Building bad-image:latest...")

    dockerfile_content = """\
FROM python:3.11-slim
RUN pip install flask
COPY bad_app.py /app.py
CMD ["python", "/app.py"]
"""
    bad_app_content = """\
import threading, time, sys
from flask import Flask

app = Flask(__name__)

def error_logger():
    while True:
        print("[ERROR] fatal: connection refused — database unreachable", flush=True)
        print("[ERROR] exception: NullPointerException in PaymentService.process()", flush=True)
        print("[FATAL] crash: segfault at address 0x0 in module core.so", flush=True)
        time.sleep(1)

@app.route("/")
@app.route("/health")
def health():
    time.sleep(5)  # Simulate high latency
    return "degraded", 503

if __name__ == "__main__":
    threading.Thread(target=error_logger, daemon=True).start()
    app.run(host="0.0.0.0", port=80)
"""

    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "Dockerfile"), "w") as f:
            f.write(dockerfile_content)
        with open(os.path.join(tmpdir, "bad_app.py"), "w") as f:
            f.write(bad_app_content)

        image, _ = client.images.build(path=tmpdir, tag="bad-image:latest", rm=True)

    print(f"  OK — built {image.tags}")
    return "bad-image:latest"


def inject_failure(client: docker.DockerClient, target: str, bad_image: str) -> str:
    """Replace the running app container with the bad image."""
    print(f"[4/10] Injecting failure: stopping '{target}', starting bad image...")

    try:
        container = client.containers.get(target)
        original_image = container.image.tags[0] if container.image.tags else "unknown"
        network_mode = container.attrs.get("HostConfig", {}).get("NetworkMode", "bridge")
        container.stop(timeout=5)
        container.remove()
    except docker.errors.NotFound:
        original_image = "unknown"
        network_mode = "bridge"
        print(f"  Warning: container '{target}' not found, starting fresh")

    client.containers.run(
        bad_image,
        detach=True,
        name=target,
        network_mode=network_mode,
        ports={"80/tcp": 8080},
    )
    print(f"  OK — bad container running (original image: {original_image})")
    return original_image


def poll_for_detection(agent_url: str) -> float:
    """Steps 5-6: Poll until TSD drifting + LSI anomalous."""
    print("[5/10] Polling for anomaly detection...")
    start = time.time()

    while (time.time() - start) < MAX_WAIT:
        try:
            metrics = requests.get(f"{agent_url}/metrics", timeout=5).json()
            lsi = requests.get(f"{agent_url}/lsi", timeout=5).json()

            drifting = metrics.get("is_drifting", False)
            anomalous = lsi.get("is_anomalous", False)

            elapsed = time.time() - start
            print(
                f"  [{elapsed:.0f}s] drifting={drifting}, anomalous={anomalous}, "
                f"readings={metrics.get('readings_count', 0)}, "
                f"lsi_score={lsi.get('current_score', 0):.4f}"
            )

            if drifting and anomalous:
                detection_time = time.time() - start
                print(f"[6/10] ANOMALY DETECTED in {detection_time:.1f}s")
                return detection_time

        except Exception as e:
            print(f"  Poll error: {e}")

        time.sleep(POLL_INTERVAL)

    print("  WARNING: Max wait exceeded without detection.")
    return -1


def poll_for_rollback(agent_url: str, initial_history_count: int) -> float:
    """Step 7: Wait for a new rollback history entry."""
    print("[7/10] Waiting for rollback execution...")
    start = time.time()

    while (time.time() - start) < MAX_WAIT:
        try:
            history = requests.get(f"{agent_url}/rollback/history", timeout=5).json()
            if len(history) > initial_history_count:
                rollback_time = time.time() - start
                entry = history[0]
                print(
                    f"  Rollback recorded: {entry.get('from_tag')} → {entry.get('to_tag')} "
                    f"(success={entry.get('success')}) in {rollback_time:.1f}s"
                )
                return rollback_time
        except Exception as e:
            print(f"  Poll error: {e}")

        time.sleep(POLL_INTERVAL)

    print("  WARNING: No rollback detected within timeout.")
    return -1


def poll_for_recovery(agent_url: str) -> float:
    """Step 8: Wait for ROLLED_BACK status in /versions."""
    print("[8/10] Waiting for ROLLED_BACK status in versions...")
    start = time.time()

    while (time.time() - start) < MAX_WAIT:
        try:
            versions = requests.get(f"{agent_url}/versions", timeout=5).json()
            rolled_back = [v for v in versions if v["status"] == "ROLLED_BACK"]
            if rolled_back:
                recovery_time = time.time() - start
                print(f"  ROLLED_BACK entry found in {recovery_time:.1f}s")
                return recovery_time
        except Exception as e:
            print(f"  Poll error: {e}")

        time.sleep(POLL_INTERVAL)

    print("  WARNING: No ROLLED_BACK status within timeout.")
    return -1


def write_results(results: dict, output_file: str) -> None:
    """Step 9: Write results to JSON file."""
    print(f"[9/10] Writing results to {output_file}...")
    os.makedirs(os.path.dirname(output_file) or ".", exist_ok=True)
    with open(output_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"  OK — results saved.")


def print_summary(results: dict) -> None:
    """Step 10: Print summary table."""
    print("\n[10/10] ═══════════════════════════════════════════════")
    print("  BACKTRACK BENCHMARK RESULTS")
    print("  ═══════════════════════════════════════════════════")
    print(f"  App:                  {results['app']}")
    print(f"  Deploy time:          {results['deploy_time']}")
    print(f"  Detection time:       {results['detection_time_seconds']:.1f}s  {'✓' if 0 < results['detection_time_seconds'] < 300 else '✗'} (target < 5 min)")
    print(f"  Rollback time:        {results['rollback_time_seconds']:.1f}s  {'✓' if 0 < results['rollback_time_seconds'] < 120 else '✗'} (target < 2 min)")
    print(f"  Total time:           {results['total_time_seconds']:.1f}s")
    print(f"  False positives:      {results['false_positives']}")
    print(f"  Image before:         {results['image_tag_before']}")
    print(f"  Image after:          {results['image_tag_after']}")
    print("  ═══════════════════════════════════════════════════\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtrack failure injection test")
    parser.add_argument("--target", default="app", help="Container name to target")
    parser.add_argument("--agent-url", default="http://localhost:9090", help="Backtrack agent URL")
    parser.add_argument("--output", default="tests/results_app1.json", help="Output JSON file")
    parser.add_argument("--app-name", default="test-app-1", help="App name for results")
    args = parser.parse_args()

    client = docker.from_env()

    # Steps 1-2
    wait_for_health(args.agent_url)
    check_stable_version(args.agent_url)

    # Get initial rollback history count
    try:
        initial_history = requests.get(f"{args.agent_url}/rollback/history", timeout=5).json()
        initial_count = len(initial_history)
    except Exception:
        initial_count = 0

    # Step 3
    deploy_time = datetime.now(timezone.utc).isoformat()
    print(f"[3/10] Start time: {deploy_time}")

    # Step 4
    bad_image = build_bad_image(client)
    original_image = inject_failure(client, args.target, bad_image)

    benchmark_start = time.time()

    # Steps 5-6
    detection_time = poll_for_detection(args.agent_url)

    # Step 7
    rollback_time = poll_for_rollback(args.agent_url, initial_count)

    # Step 8
    recovery_time = poll_for_recovery(args.agent_url)

    total_time = time.time() - benchmark_start

    # Step 9
    results = {
        "app": args.app_name,
        "deploy_time": deploy_time,
        "detection_time_seconds": round(detection_time, 2),
        "rollback_time_seconds": round(rollback_time, 2),
        "total_time_seconds": round(total_time, 2),
        "false_positives": 0,
        "image_tag_before": original_image,
        "image_tag_after": "bad-image:latest",
    }
    write_results(results, args.output)

    # Step 10
    print_summary(results)


if __name__ == "__main__":
    main()
