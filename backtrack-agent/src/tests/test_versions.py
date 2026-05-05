import json
from unittest.mock import patch

import pytest
from src.versions import MAX_STABLE, Snapshot, VersionStore


def versions_file(tmp_path):
    return str(tmp_path / "versions.json")


def make_store(tmp_path, image_tag="v1.0.0", service_name="test-svc"):
    path = versions_file(tmp_path)
    with patch("src.versions.VERSIONS_FILE", path):
        vs = VersionStore(service_name=service_name)
        if image_tag:
            vs.create_pending(image_tag=image_tag)
        return vs, path


def make_snapshot(image_tag="v1.0.0", status="STABLE", snap_id="", service_name="test-svc"):
    return Snapshot(
        id=snap_id or f"id-{image_tag}",
        service_name=service_name,
        platform="docker",
        environment="production",
        image_tag=image_tag,
        commit_sha="",
        status=status,
        deployed_at="2026-01-01T00:00:00+00:00",
        stable_at=None,
        k8s_revision=0,
        docker_container_name=service_name,
    )


# --- create_pending / init ---

def test_create_pending_creates_snapshot(tmp_path):
    vs, _ = make_store(tmp_path)
    pending = vs.get_current_pending()
    assert pending is not None
    assert pending.image_tag == "v1.0.0"
    assert pending.status == "PENDING"
    assert pending.service_name == "test-svc"


def test_create_pending_persists_snapshot_to_file(tmp_path):
    _, path = make_store(tmp_path)
    data = json.loads(open(path).read())
    assert any(d["image_tag"] == "v1.0.0" for d in data)
    assert any(d["status"] == "PENDING" for d in data)


def test_init_loads_existing_snapshots(tmp_path):
    path = versions_file(tmp_path)
    existing = [{
        "id": "old-id",
        "service_name": "test-svc",
        "platform": "docker",
        "environment": "production",
        "image_tag": "v0.9.0",
        "commit_sha": "",
        "status": "STABLE",
        "deployed_at": "2026-01-01T00:00:00+00:00",
        "stable_at": None,
        "k8s_revision": 0,
        "docker_container_name": "test-svc",
        "tsd_baseline": {},
        "lsi_baseline": 0.0,
        "github_deployment_id": None,
    }]
    open(path, "w").write(json.dumps(existing))
    with patch("src.versions.VERSIONS_FILE", path):
        vs = VersionStore(service_name="test-svc")
        vs.create_pending(image_tag="v1.0.0")
    all_snaps = vs.get_all()
    assert len(all_snaps) == 2
    assert all_snaps[0]["image_tag"] == "v1.0.0"
    assert all_snaps[1]["image_tag"] == "v0.9.0"


def test_init_handles_corrupt_file(tmp_path):
    path = versions_file(tmp_path)
    open(path, "w").write("not json")
    with patch("src.versions.VERSIONS_FILE", path):
        vs = VersionStore(service_name="test-svc")
        vs.create_pending(image_tag="v1.0.0")
    assert len(vs.snapshots) == 1
    assert vs.snapshots[0].image_tag == "v1.0.0"


def test_init_handles_missing_file(tmp_path):
    path = str(tmp_path / "nonexistent.json")
    with patch("src.versions.VERSIONS_FILE", path):
        vs = VersionStore(service_name="test-svc")
        vs.create_pending(image_tag="v1.0.0")
    assert len(vs.snapshots) == 1


def test_create_pending_with_full_metadata(tmp_path):
    path = versions_file(tmp_path)
    with patch("src.versions.VERSIONS_FILE", path):
        vs = VersionStore(service_name="svc-x")
        vid = vs.create_pending(
            image_tag="ghcr.io/org/svc-x:abc",
            commit_sha="abc123",
            environment="staging",
            github_deployment_id="42",
        )
    pending = vs.get_current_pending()
    assert pending.commit_sha == "abc123"
    assert pending.environment == "staging"
    assert pending.github_deployment_id == "42"
    assert pending.id == vid


# --- legacy v1 snapshot normalisation ---

def test_legacy_snapshot_loads_without_error(tmp_path):
    path = versions_file(tmp_path)
    legacy = [{
        "id": "abc",
        "timestamp": "2024-01-01T00:00:00+00:00",
        "image_tag": "myapp:old",
        "status": "STABLE",
        "tsd_baseline": {},
        "lsi_baseline": 0.0,
        "k8s_revision": 0,
    }]
    open(path, "w").write(json.dumps(legacy))
    with patch("src.versions.VERSIONS_FILE", path):
        vs = VersionStore(service_name="myapp")
    # Should have loaded and normalised the legacy snapshot
    all_snaps = vs.get_all()
    assert any(s["image_tag"] == "myapp:old" for s in all_snaps)


# --- mark_stable ---

def test_mark_stable_changes_status(tmp_path):
    vs, _ = make_store(tmp_path)
    pending = vs.get_current_pending()
    vs.mark_stable(pending.id, tsd_baseline={"cpu": 5.0}, lsi_baseline=0.25)
    snap = next(s for s in vs.snapshots if s.id == pending.id)
    assert snap.status == "STABLE"
    assert snap.tsd_baseline == {"cpu": 5.0}
    assert snap.lsi_baseline == 0.25
    assert snap.stable_at is not None


def test_mark_stable_uses_empty_dict_when_no_baseline(tmp_path):
    vs, _ = make_store(tmp_path)
    pending = vs.get_current_pending()
    vs.mark_stable(pending.id)
    snap = next(s for s in vs.snapshots if s.id == pending.id)
    assert snap.tsd_baseline == {}
    assert snap.lsi_baseline == 0.0


def test_mark_stable_ignores_unknown_id(tmp_path):
    vs, _ = make_store(tmp_path)
    vs.mark_stable("nonexistent-id")
    assert vs.get_current_pending() is not None


def test_mark_stable_prunes_oldest_when_over_max(tmp_path):
    vs, _ = make_store(tmp_path)
    for i in range(MAX_STABLE + 1):
        vs.snapshots.append(make_snapshot(f"v0.{i}.0", "STABLE"))
    pending = vs.get_current_pending()
    vs.mark_stable(pending.id)
    stable = [s for s in vs.snapshots if s.status == "STABLE"]
    assert len(stable) <= MAX_STABLE


def test_mark_stable_persists_to_file(tmp_path):
    path = str(tmp_path / "versions.json")
    with patch("src.versions.VERSIONS_FILE", path):
        vs = VersionStore(service_name="test-svc")
        vs.create_pending(image_tag="v1.0.0")
        vs.mark_stable(vs.get_current_pending().id)
    data = json.loads(open(path).read())
    statuses = [d["status"] for d in data if d.get("service_name") == "test-svc"]
    assert "STABLE" in statuses


def test_mark_stable_sets_k8s_revision(tmp_path):
    vs, _ = make_store(tmp_path)
    pending = vs.get_current_pending()
    vs.mark_stable(pending.id, k8s_revision=7)
    snap = next(s for s in vs.snapshots if s.id == pending.id)
    assert snap.k8s_revision == 7


# --- mark_rolled_back ---

def test_mark_rolled_back_changes_status(tmp_path):
    vs, _ = make_store(tmp_path)
    pending = vs.get_current_pending()
    vs.mark_rolled_back(pending.id)
    assert pending.status == "ROLLED_BACK"


def test_mark_rolled_back_ignores_unknown_id(tmp_path):
    vs, _ = make_store(tmp_path)
    vs.mark_rolled_back("nonexistent-id")


def test_mark_rolled_back_persists_to_file(tmp_path):
    path = str(tmp_path / "versions.json")
    with patch("src.versions.VERSIONS_FILE", path):
        vs = VersionStore(service_name="test-svc")
        vs.create_pending(image_tag="v1.0.0")
        vs.mark_rolled_back(vs.get_current_pending().id)
    data = json.loads(open(path).read())
    svc_snaps = [d for d in data if d.get("service_name") == "test-svc"]
    assert svc_snaps[0]["status"] == "ROLLED_BACK"


# --- get_last_stable ---

def test_get_last_stable_none_when_no_stable(tmp_path):
    vs, _ = make_store(tmp_path)
    assert vs.get_last_stable() is None


def test_get_last_stable_returns_most_recent(tmp_path):
    vs, _ = make_store(tmp_path)
    vs.snapshots.append(make_snapshot("v0.8", "STABLE"))
    vs.snapshots.append(make_snapshot("v0.9", "STABLE"))
    result = vs.get_last_stable()
    assert result is not None


def test_get_last_stable_skips_non_stable(tmp_path):
    vs, _ = make_store(tmp_path)
    vs.snapshots.append(make_snapshot("v0.8", "ROLLED_BACK"))
    vs.snapshots.append(make_snapshot("v0.9", "STABLE"))
    result = vs.get_last_stable()
    assert result.image_tag == "v0.9"


# --- get_current_pending ---

def test_get_current_pending_returns_pending(tmp_path):
    vs, _ = make_store(tmp_path)
    result = vs.get_current_pending()
    assert result is not None
    assert result.status == "PENDING"
    assert result.image_tag == "v1.0.0"


def test_get_current_pending_none_after_mark_stable(tmp_path):
    vs, _ = make_store(tmp_path)
    pending = vs.get_current_pending()
    vs.mark_stable(pending.id)
    assert vs.get_current_pending() is None


def test_get_current_pending_none_after_mark_rolled_back(tmp_path):
    vs, _ = make_store(tmp_path)
    pending = vs.get_current_pending()
    vs.mark_rolled_back(pending.id)
    assert vs.get_current_pending() is None


# --- multi-service isolation ---

def test_multi_service_stores_dont_cross_pollute(tmp_path):
    path = versions_file(tmp_path)
    with patch("src.versions.VERSIONS_FILE", path):
        vs_a = VersionStore(service_name="svc-a")
        vs_a.create_pending(image_tag="a:v1")
        vs_b = VersionStore(service_name="svc-b")
        vs_b.create_pending(image_tag="b:v1")

    with patch("src.versions.VERSIONS_FILE", path):
        reloaded_a = VersionStore(service_name="svc-a")

    for snap in reloaded_a.snapshots:
        assert snap.service_name == "svc-a", f"Cross-service pollution: {snap}"


# --- get_all ---

def test_get_all_returns_list_of_dicts(tmp_path):
    vs, _ = make_store(tmp_path)
    result = vs.get_all()
    assert isinstance(result, list)
    assert isinstance(result[0], dict)


def test_get_all_contains_expected_fields(tmp_path):
    vs, _ = make_store(tmp_path)
    snap = vs.get_all()[0]
    assert "id" in snap
    assert "image_tag" in snap
    assert "status" in snap
    assert "service_name" in snap
    assert "deployed_at" in snap


def test_get_all_reflects_current_snapshots(tmp_path):
    vs, _ = make_store(tmp_path)
    vs.snapshots.append(make_snapshot("v0.9", "STABLE"))
    assert len(vs.get_all()) == 2
