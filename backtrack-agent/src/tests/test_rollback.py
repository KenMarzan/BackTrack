"""
Tests for RollbackExecutor.

Note: rollback execution logic (_rollback_docker, _rollback_kubernetes, trigger)
moved to src/runtime/docker_adapter.py and src/runtime/kubernetes.py in v0.3.
RollbackExecutor now manages only the history log.
"""
import json
from unittest.mock import MagicMock, patch

import pytest
from src.rollback.executor import RollbackExecutor
from src.versions import Snapshot, VersionStore


def make_snapshot(image_tag: str, status: str = "STABLE", snap_id: str = "") -> Snapshot:
    return Snapshot(
        id=snap_id or f"id-{image_tag}",
        service_name="test-svc",
        platform="docker",
        environment="production",
        image_tag=image_tag,
        commit_sha="",
        status=status,
        deployed_at="2026-01-01T00:00:00+00:00",
        stable_at=None,
        k8s_revision=0,
        docker_container_name="test-svc",
    )


@pytest.fixture()
def mock_store():
    store = MagicMock(spec=VersionStore)
    store.get_last_stable.return_value = make_snapshot("v1.0.0")
    store.get_current_pending.return_value = make_snapshot("v1.1.0", status="PENDING", snap_id="id-pending")
    return store


@pytest.fixture()
def executor(mock_store):
    return RollbackExecutor(version_store=mock_store)


# --- _append_log ---

def test_append_log_creates_file(executor, tmp_path):
    log_path = tmp_path / "log.json"
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", str(log_path)):
        executor._append_log("test reason", "v1.1.0", "v1.0.0", True)

    entries = json.loads(log_path.read_text())
    assert len(entries) == 1
    assert entries[0]["from_tag"] == "v1.1.0"
    assert entries[0]["to_tag"] == "v1.0.0"
    assert entries[0]["success"] is True
    assert entries[0]["reason"] == "test reason"
    assert "id" in entries[0]
    assert "timestamp" in entries[0]


def test_append_log_prepends_newest_first(executor, tmp_path):
    log_path = tmp_path / "log.json"
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", str(log_path)):
        executor._append_log("first", "v1.0", "v0.9", True)
        executor._append_log("second", "v1.1", "v1.0", False)

    entries = json.loads(log_path.read_text())
    assert entries[0]["reason"] == "second"
    assert entries[1]["reason"] == "first"


def test_append_log_survives_corrupt_existing_file(executor, tmp_path):
    log_path = tmp_path / "log.json"
    log_path.write_text("not valid json")
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", str(log_path)):
        executor._append_log("test", "v1.1", "v1.0", True)

    entries = json.loads(log_path.read_text())
    assert len(entries) == 1


def test_append_log_records_failure(executor, tmp_path):
    log_path = tmp_path / "log.json"
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", str(log_path)):
        executor._append_log("crash", "v1.1", "v1.0", False)

    entries = json.loads(log_path.read_text())
    assert entries[0]["success"] is False


def test_append_log_records_service_name(executor, tmp_path):
    log_path = tmp_path / "log.json"
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", str(log_path)):
        executor._append_log("anomaly", "v2", "v1", True, service_name="my-app")

    entries = json.loads(log_path.read_text())
    assert entries[0]["service_name"] == "my-app"


def test_append_log_records_timestamps(executor, tmp_path):
    log_path = tmp_path / "log.json"
    triggered = "2026-01-01T00:00:01+00:00"
    completed = "2026-01-01T00:00:05+00:00"
    first_anomaly = "2026-01-01T00:00:00+00:00"
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", str(log_path)):
        executor._append_log(
            "test", "v1.1", "v1.0", True,
            rollback_triggered_at=triggered,
            rollback_completed_at=completed,
            first_anomaly_at=first_anomaly,
        )

    entries = json.loads(log_path.read_text())
    assert entries[0]["rollback_triggered_at"] == triggered
    assert entries[0]["rollback_completed_at"] == completed
    assert entries[0]["first_anomaly_at"] == first_anomaly


# --- get_history ---

def test_get_history_no_file(tmp_path):
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", str(tmp_path / "missing.json")):
        assert RollbackExecutor.get_history() == []


def test_get_history_returns_entries(tmp_path):
    log_path = tmp_path / "log.json"
    log_path.write_text(json.dumps([{"id": "abc", "success": True}]))
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", str(log_path)):
        result = RollbackExecutor.get_history()
    assert result == [{"id": "abc", "success": True}]


def test_get_history_returns_empty_on_corrupt_file(tmp_path):
    log_path = tmp_path / "log.json"
    log_path.write_text("not json")
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", str(log_path)):
        assert RollbackExecutor.get_history() == []


def test_get_history_accumulates_multiple_entries(executor, tmp_path):
    log_path = tmp_path / "log.json"
    with patch("src.rollback.executor.ROLLBACK_LOG_FILE", str(log_path)):
        executor._append_log("first", "v1.0", "v0.9", True)
        executor._append_log("second", "v1.1", "v1.0", False)
        history = RollbackExecutor.get_history()

    assert len(history) == 2
    assert history[0]["reason"] == "second"  # newest first
