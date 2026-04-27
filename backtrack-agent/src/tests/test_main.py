import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import src.main as main_module
from src.main import (
    STABLE_THRESHOLD_SECONDS,
    _discover_services,
    get_config,
    get_lsi,
    get_metrics,
    get_services,
    get_versions,
    health,
    polling_loop,
    rollback_history,
    rollback_trigger,
)


@pytest.fixture(autouse=True)
def reset_state():
    """Isolate module-level mutable state between tests."""
    main_module.service_monitors.clear()
    main_module.consecutive_anomaly_counts.clear()
    main_module.clean_seconds_map.clear()
    main_module.version_store = None
    main_module.rollback_executor = None
    yield
    main_module.service_monitors.clear()
    main_module.consecutive_anomaly_counts.clear()
    main_module.clean_seconds_map.clear()
    main_module.version_store = None
    main_module.rollback_executor = None


@pytest.fixture(autouse=True)
def mock_config():
    with patch("src.main.config") as cfg:
        cfg.mode = "docker"
        cfg.target = "my-app"
        cfg.scrape_interval = 10
        cfg.image_tag = "v1.0.0"
        cfg.k8s_namespace = "default"
        yield cfg


def make_tsd(drifting=False, readings=2):
    tsd = MagicMock()
    tsd.is_drifting.return_value = drifting
    tsd.cpu_history = [1.0] * readings
    tsd.get_metrics.return_value = {"current": {"cpu_percent": 5.0}}
    return tsd


def make_lsi(anomalous=False, fitted=True):
    lsi = MagicMock()
    lsi.is_anomalous.return_value = anomalous
    lsi.fitted = fitted
    lsi.get_lsi.return_value = {"fitted": fitted, "baseline_mean": 0.5}
    return lsi


# --- /health ---

async def test_health_returns_ok():
    result = await health()
    assert result["status"] == "ok"


async def test_health_includes_mode():
    result = await health()
    assert result["mode"] == "docker"


async def test_health_includes_monitored_services():
    main_module.service_monitors["svc-a"] = (make_tsd(), make_lsi())
    result = await health()
    assert "svc-a" in result["monitored_services"]


async def test_health_uptime_is_non_negative():
    result = await health()
    assert result["uptime_seconds"] >= 0


# --- /config ---

async def test_get_config_delegates_to_config(mock_config):
    mock_config.to_dict.return_value = {"mode": "docker", "target": "my-app"}
    result = await get_config()
    assert result == {"mode": "docker", "target": "my-app"}


# --- /services ---

async def test_get_services_empty_when_no_monitors():
    assert await get_services() == []


async def test_get_services_shape():
    main_module.service_monitors["svc"] = (make_tsd(), make_lsi())
    result = await get_services()
    assert len(result) == 1
    assert result[0]["name"] == "svc"
    assert result[0]["is_drifting"] is False
    assert result[0]["is_anomalous"] is False
    assert result[0]["lsi_fitted"] is True
    assert result[0]["readings_count"] == 2


async def test_get_services_multiple():
    main_module.service_monitors["a"] = (make_tsd(), make_lsi())
    main_module.service_monitors["b"] = (make_tsd(drifting=True), make_lsi(anomalous=True))
    result = await get_services()
    names = {r["name"] for r in result}
    assert names == {"a", "b"}


# --- /metrics ---

async def test_get_metrics_empty_when_no_monitors(mock_config):
    mock_config.target = "nonexistent"
    assert await get_metrics(service="") == {}


async def test_get_metrics_by_name():
    tsd = make_tsd()
    main_module.service_monitors["svc"] = (tsd, make_lsi())
    assert await get_metrics(service="svc") == tsd.get_metrics()


async def test_get_metrics_falls_back_to_first(mock_config):
    mock_config.target = "nonexistent"
    tsd = make_tsd()
    main_module.service_monitors["only"] = (tsd, make_lsi())
    assert await get_metrics(service="") == tsd.get_metrics()


# --- /lsi ---

async def test_get_lsi_empty_when_no_monitors(mock_config):
    mock_config.target = "nonexistent"
    assert await get_lsi(service="") == {}


async def test_get_lsi_by_name():
    lsi = make_lsi()
    main_module.service_monitors["svc"] = (make_tsd(), lsi)
    assert await get_lsi(service="svc") == lsi.get_lsi()


async def test_get_lsi_falls_back_to_first(mock_config):
    mock_config.target = "nonexistent"
    lsi = make_lsi()
    main_module.service_monitors["only"] = (make_tsd(), lsi)
    assert await get_lsi(service="") == lsi.get_lsi()


# --- /versions ---

async def test_get_versions_empty_when_no_store():
    assert await get_versions() == []


async def test_get_versions_delegates_to_store():
    mock_store = MagicMock()
    mock_store.get_all.return_value = [{"id": "abc"}]
    main_module.version_store = mock_store
    assert await get_versions() == [{"id": "abc"}]


# --- /rollback/history ---

async def test_rollback_history_delegates():
    with patch("src.main.RollbackExecutor.get_history", return_value=[{"id": "x"}]):
        result = await rollback_history()
    assert result == [{"id": "x"}]


# --- /rollback/trigger ---

async def test_rollback_trigger_no_executor():
    result = await rollback_trigger()
    assert result["success"] is False
    assert "not initialised" in result["message"].lower()


async def test_rollback_trigger_delegates_to_executor():
    mock_exec = MagicMock()
    mock_exec.trigger.return_value = {"success": True, "message": "done"}
    main_module.rollback_executor = mock_exec
    result = await rollback_trigger()
    assert result["success"] is True
    mock_exec.trigger.assert_called_once_with(reason="Manual trigger via dashboard")


# --- _discover_services ---

async def test_discover_docker_returns_target(mock_config):
    mock_config.mode = "docker"
    mock_config.target = "my-container"
    assert await _discover_services() == [("my-container", "")]


async def test_discover_kubernetes_parses_deployments(mock_config):
    mock_config.mode = "kubernetes"
    mock_proc = MagicMock()
    mock_proc.communicate = AsyncMock(return_value=(b"api-service\nworker\n", b""))
    with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
        result = await _discover_services()
    assert ("api-service", "app=api-service") in result
    assert ("worker", "app=worker") in result


async def test_discover_kubernetes_falls_back_on_empty_output(mock_config):
    mock_config.mode = "kubernetes"
    mock_config.target = "fallback-app"
    mock_proc = MagicMock()
    mock_proc.communicate = AsyncMock(return_value=(b"", b""))
    with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
        result = await _discover_services()
    assert result == [("fallback-app", "app=fallback-app")]


async def test_discover_kubernetes_falls_back_on_exception(mock_config):
    mock_config.mode = "kubernetes"
    mock_config.target = "fallback-app"
    with patch("asyncio.create_subprocess_exec", side_effect=Exception("kubectl not found")):
        result = await _discover_services()
    assert result == [("fallback-app", "app=fallback-app")]


# --- polling_loop ---

async def _run_n_cycles(n: int) -> None:
    """Run exactly n iterations of the polling loop then cancel it."""
    call_count = 0

    async def limited_sleep(_):
        nonlocal call_count
        call_count += 1
        if call_count > n:
            raise asyncio.CancelledError()

    with patch("asyncio.sleep", side_effect=limited_sleep):
        try:
            await polling_loop()
        except asyncio.CancelledError:
            pass


async def test_polling_loop_no_rollback_before_3_cycles(mock_config):
    main_module.service_monitors["svc"] = (make_tsd(drifting=True), make_lsi(anomalous=True))
    mock_exec = MagicMock()
    main_module.rollback_executor = mock_exec
    await _run_n_cycles(2)
    mock_exec.trigger.assert_not_called()


async def test_polling_loop_triggers_rollback_after_3_cycles(mock_config):
    main_module.service_monitors["svc"] = (make_tsd(drifting=True), make_lsi(anomalous=True))
    mock_exec = MagicMock()
    main_module.rollback_executor = mock_exec
    await _run_n_cycles(3)
    mock_exec.trigger.assert_called_once()


async def test_polling_loop_resets_count_after_clean_cycle(mock_config):
    main_module.service_monitors["svc"] = (make_tsd(drifting=True), make_lsi(anomalous=True))
    mock_exec = MagicMock()
    main_module.rollback_executor = mock_exec

    # 2 anomaly cycles, then 1 clean cycle, then 2 more — should NOT trigger rollback
    tsd = make_tsd(drifting=True)
    lsi = make_lsi(anomalous=True)
    main_module.service_monitors["svc"] = (tsd, lsi)

    call_count = 0

    async def toggling_sleep(_):
        nonlocal call_count
        call_count += 1
        # On the 3rd iteration, flip to clean
        if call_count == 3:
            tsd.is_drifting.return_value = False
            lsi.is_anomalous.return_value = False
        if call_count > 5:
            raise asyncio.CancelledError()

    with patch("asyncio.sleep", side_effect=toggling_sleep):
        try:
            await polling_loop()
        except asyncio.CancelledError:
            pass

    mock_exec.trigger.assert_not_called()


async def test_polling_loop_marks_stable_after_threshold(mock_config):
    mock_config.scrape_interval = 10
    tsd = make_tsd(drifting=False)
    lsi = make_lsi(anomalous=False)
    main_module.service_monitors["svc"] = (tsd, lsi)

    mock_store = MagicMock()
    pending = MagicMock()
    pending.id = "pending-id"
    pending.status = "PENDING"
    mock_store.get_current_pending.return_value = pending
    main_module.version_store = mock_store

    # Pre-seed clean time so one more cycle pushes it over the threshold
    main_module.clean_seconds_map["svc"] = STABLE_THRESHOLD_SECONDS - 10

    await _run_n_cycles(1)

    mock_store.mark_stable.assert_called_once_with(
        "pending-id",
        tsd_baseline=tsd.get_metrics().get("current", {}),
        lsi_baseline=lsi.get_lsi().get("baseline_mean", 0.0),
    )
