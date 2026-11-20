import importlib

import pytest
from fastapi.testclient import TestClient

from app.fetcher import FetchError, check_url
from app.model import ModelStore
from app.synthetic import generate
from app.train import NotEnoughHistory, backtest, synthetic_input


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    store = ModelStore(tmp_path_factory.mktemp("models"))
    result = backtest(synthetic_input(seed=7), store=store)
    return store, result


def test_model_beats_the_baseline_and_keeps_coverage(trained):
    _, result = trained
    assert result["model"]["wape"] < result["baseline"]["wape"]
    assert result["model"]["p90_coverage"] >= 0.85
    assert result["promoted"] is True


def test_refuses_to_train_on_too_little_history(tmp_path):
    data = synthetic_input(seed=7)
    first_days = sorted({h["date"] for h in data["history"]})[:30]
    data["history"] = [h for h in data["history"] if h["date"] in first_days]
    store = ModelStore(tmp_path)
    with pytest.raises(NotEnoughHistory, match="Need at least 44 days"):
        backtest(data, store=store)
    assert store.latest() is None


def test_promoted_model_is_served(trained):
    store, result = trained
    assert store.latest().version == result["version"]


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("ML_SERVICE_TOKEN", "test-token")
    monkeypatch.setenv("MODEL_DIR", str(tmp_path))
    import app.main as main
    importlib.reload(main)
    return TestClient(main.app)


AUTH = {"Authorization": "Bearer test-token"}


def forecast_payload(days=3):
    g = generate(seed=3, weeks=2, n_students=300)
    return {
        "dates": g["dates"][:days],
        "riders": [r.model_dump(by_alias=True) for r in g["riders"]],
        "sessions": [s.model_dump(by_alias=True) for s in g["sessions"]],
        "slots": [s.model_dump(by_alias=True) for s in g["slots"]],
        "calendar": [],
        "history": [],
        "attendanceFactorColdStart": 0.8,
    }


def test_service_token_is_required(client):
    assert client.get("/health").status_code == 200
    assert client.post("/v1/forecast", json=forecast_payload()).status_code == 401
    assert client.post("/v1/forecast", json=forecast_payload(), headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_cold_start_forecast(client):
    res = client.post("/v1/forecast", json=forecast_payload(), headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    assert body["modelVersion"] == "cold-start"
    rows = [r for r in body["rows"] if r["expectedMax"] > 0]
    assert rows
    for r in rows:
        assert r["predicted"] <= r["expectedMax"]
        assert r["p90"] >= r["predicted"]
        assert set(r) == {"date", "timeSlotId", "expectedMax", "predicted", "p90"}


def test_plan_endpoint(client):
    payload = {"date": "2026-11-21", "bufferPct": 0.1,
               "slots": [{"timeSlotId": "a", "demand": 70, "windowStart": 420, "windowEnd": 525, "audience": "student"}],
               "buses": [{"busId": "1", "code": "H-10", "operatorCode": "H", "capacity": 40, "pool": "student"},
                         {"busId": "2", "code": "H-12", "operatorCode": "H", "capacity": 40, "pool": "student"}]}
    res = client.post("/v1/allocation/plan", json=payload, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["assignments"][0]["busIds"] == ["1", "2"]


def test_routine_upload(client):
    csv = b"department,batch,section,teacher_initial,day,start_time,end_time,course_code,room\nSWE,41,G,MRH,Sat,08:30,10:00,SE331,602\n"
    res = client.post("/v1/routines/parse", files={"file": ("r.csv", csv, "text/csv")}, data={"department": "SWE"}, headers=AUTH)
    assert res.status_code == 200
    assert res.json()["sessions"][0]["startMinutes"] == 510


def test_fetcher_blocks_unsafe_links(monkeypatch):
    monkeypatch.setenv("ALLOWED_FETCH_HOSTS", "daffodilvarsity.edu.bd")
    public = lambda host, port: [(None, None, None, None, ("103.1.2.3", port))]  # noqa: E731
    private = lambda host, port: [(None, None, None, None, ("10.0.0.5", port))]  # noqa: E731
    assert check_url("https://swe.daffodilvarsity.edu.bd/routine.pdf", resolve=public)
    with pytest.raises(FetchError):
        check_url("http://swe.daffodilvarsity.edu.bd/routine.pdf", resolve=public)
    with pytest.raises(FetchError):
        check_url("https://evil.example.com/routine.pdf", resolve=public)
    with pytest.raises(FetchError):
        check_url("https://swe.daffodilvarsity.edu.bd/routine.pdf", resolve=private)


def test_history_length_feature_is_capped():
    # A raw day counter would act as a clock the trees cannot extrapolate past training.
    from app.features import OBS_CAP
    from app.train import rolling_frame
    data = synthetic_input(seed=7)
    dates = sorted({h["date"] for h in data["history"]})
    frame = rolling_frame(dates, data["expected"], data["history"], data["slots"], data["calendar"])
    assert frame["slot_obs"].max() == OBS_CAP
