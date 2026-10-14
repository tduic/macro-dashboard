"""Offline tests for backend/snapshot.py (the static public-build exporter).

Every upstream is replaced by tests/fakes.py (yfinance.Ticker, requests.get for
FRED, feedparser.parse), the same seams the other suites mock.
"""
import json
from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

import cache
import main
import snapshot
from data import market
from tests import fixture_snapshot
from tests.fakes import fake_upstreams, market_series

END = date(2026, 6, 5)
NOW = datetime(2026, 6, 5, 21, 0, tzinfo=timezone.utc)


@pytest.fixture
def client():
    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def fakes():
    with fake_upstreams(end=END, now=NOW):
        yield


@pytest.fixture(scope="module")
def snap():
    """One full fixture snapshot shared by the read-only assertions below."""
    cache.clear_all()
    with fake_upstreams(end=END, now=NOW), TestClient(main.app) as c:
        files = snapshot.build_snapshot(c, now=NOW, source="fixture")
    cache.clear_all()
    return files


@pytest.fixture
def fakes_no_fred():
    with fake_upstreams(end=END, now=NOW, fred_key=None):
        yield


# ---- build_snapshot ----------------------------------------------------------
def test_snapshot_has_every_top_level_file(snap):
    files = snap
    for name in ("meta.json", "indicators.json", "news.json", "calendar.json",
                 "curves-ust.json", "events.json"):
        assert name in files, name


def test_snapshot_payloads_match_live_routes(client, fakes, snap):
    files = snap
    live = client.get("/api/indicators").json()
    snap = files["indicators.json"]
    # asOf is a wall-clock stamp; everything else is the exact route output
    assert {k: v for k, v in snap.items() if k != "asOf"} == {k: v for k, v in live.items() if k != "asOf"}
    assert files["news.json"]["items"] == client.get("/api/news").json()["items"]
    assert files["calendar.json"] == client.get("/api/calendar").json()
    assert files["curves-ust.json"] == client.get("/api/curves/ust").json()


def test_snapshot_writes_history_for_every_indicator_and_range(snap):
    files = snap
    ids = [i["id"] for i in files["indicators.json"]["indicators"]]
    assert len(ids) > 40  # market + ratios + FRED with the key set
    for ind_id in ids:
        for rng in snapshot.RANGES:
            body = files[f"history/{ind_id}/{rng}.json"]
            assert body["id"] == ind_id and body["range"] == rng
            assert body["points"], f"{ind_id} {rng} empty"
    assert files["meta.json"]["history"] == {i: list(snapshot.RANGES) for i in ids}


def test_snapshot_history_matches_route_and_ranges_nest(client, fakes, snap):
    files = snap
    for rng in snapshot.RANGES:
        assert files[f"history/SPY/{rng}.json"] == client.get(f"/api/indicators/SPY/history?range={rng}").json()
    n = {r: len(files[f"history/GSPC/{r}.json"]["points"]) for r in ("1W", "1M", "1Y", "5Y")}
    assert n["1W"] < n["1M"] < n["1Y"] < n["5Y"]


def test_snapshot_meta(snap):
    meta = snap["meta.json"]
    assert meta["format"] == snapshot.SNAPSHOT_FORMAT
    assert meta["generatedAt"] == NOW.isoformat() == meta["lastRefreshed"]
    assert meta["source"] == "fixture"
    assert meta["fredEnabled"] is True
    assert meta["categories"] == main.CATEGORY_ORDER
    assert meta["ranges"] == list(snapshot.RANGES)
    assert meta["indicatorCount"] > 40
    assert meta["newsCount"] > 0


def test_events_window_covers_5y_history_and_upcoming_releases(snap):
    files = snap
    win = files["meta.json"]["eventsWindow"]
    oldest = min(files[f"history/{i}/5Y.json"]["points"][0]["date"]
                 for i in files["meta.json"]["history"])
    assert win["from"] <= oldest
    # the frontend's release strip asks for today + 60d
    assert win["to"] >= "2026-08-04"
    ev = files["events.json"]
    assert (ev["from"], ev["to"]) == (win["from"], win["to"])
    types = {e["type"] for e in ev["events"]}
    assert {"FOMC", "CPI", "NFP"} <= types
    assert all(win["from"] <= e["date"] <= win["to"] for e in ev["events"])


def test_snapshot_without_fred_key_drops_fred_panels(client, fakes_no_fred):
    files = snapshot.build_snapshot(client, now=NOW)
    assert files["meta.json"]["fredEnabled"] is False
    assert files["calendar.json"] == {"enabled": False, "items": []}
    assert files["curves-ust.json"] == {"enabled": False, "curves": {}}
    cats = {i["category"] for i in files["indicators.json"]["indicators"]}
    assert "Rates" not in cats and "Economic Data" not in cats
    assert "Equities" in cats
    # FOMC dates are hardcoded, so overlays still have something without a key
    assert {e["type"] for e in files["events.json"]["events"]} == {"FOMC"}


def test_unsafe_indicator_ids_get_no_history_files(client, fakes, monkeypatch):
    real = market.get_market_indicators

    def with_bad_id():
        items = real()
        bad = dict(items[0], id="../../etc")
        return [bad, *items]

    monkeypatch.setattr(market, "get_market_indicators", with_bad_id)
    files = snapshot.build_snapshot(client, now=NOW)
    assert not any(".." in path for path in files)
    assert "../../etc" not in files["meta.json"]["history"]


def test_failed_history_is_omitted_not_fatal(client, fakes, monkeypatch):
    real = market.get_market_history

    def flaky(i, r):
        if (i, r) == ("SPY", "5Y"):
            raise RuntimeError("boom")
        return real(i, r)

    monkeypatch.setattr(market, "get_market_history", flaky)
    files = snapshot.build_snapshot(TestClient(main.app, raise_server_exceptions=False), now=NOW)
    assert "history/SPY/5Y.json" not in files
    assert "5Y" not in files["meta.json"]["history"]["SPY"]
    assert "history/SPY/1Y.json" in files


def test_core_route_failure_raises(client, fakes, monkeypatch):
    monkeypatch.setattr(market, "get_market_indicators", lambda: 1 / 0)
    with pytest.raises(snapshot.SnapshotError, match="/api/indicators"):
        snapshot.build_snapshot(TestClient(main.app, raise_server_exceptions=False), now=NOW)


# ---- write_snapshot / run / CLI -----------------------------------------------
def test_write_snapshot_replaces_dir_and_writes_compact_json(tmp_path):
    out = tmp_path / "snap"
    (out / "history" / "OLD").mkdir(parents=True)
    (out / "history" / "OLD" / "1Y.json").write_text("{}")
    size = snapshot.write_snapshot({"meta.json": {"a": 1}, "history/X/1Y.json": {"p": [1, 2]}}, out)
    assert not (out / "history" / "OLD").exists()  # stale files from a previous run are gone
    assert (out / "meta.json").read_text() == '{"a":1}'
    assert json.loads((out / "history" / "X" / "1Y.json").read_text()) == {"p": [1, 2]}
    assert size == len('{"a":1}') + len('{"p":[1,2]}')


def test_write_snapshot_refuses_paths_outside_out_dir(tmp_path):
    with pytest.raises(snapshot.SnapshotError):
        snapshot.write_snapshot({"../escape.json": {}}, tmp_path / "snap")
    assert not (tmp_path / "escape.json").exists()


def test_write_snapshot_rejects_nan(tmp_path):
    with pytest.raises(ValueError):
        snapshot.write_snapshot({"meta.json": {"x": float("nan")}}, tmp_path / "snap")


def test_run_writes_files(tmp_path, fakes):
    snapshot.run(tmp_path / "snap", now=NOW, min_indicators=10)
    meta = json.loads((tmp_path / "snap" / "meta.json").read_text())
    assert meta["source"] == "live"
    assert (tmp_path / "snap" / "history" / "GSPC" / "1Y.json").exists()


def test_run_refuses_thin_snapshot_and_writes_nothing(tmp_path, fakes, monkeypatch):
    monkeypatch.setattr(market, "get_market_indicators", lambda: [])
    monkeypatch.delenv("FRED_API_KEY")
    with pytest.raises(snapshot.SnapshotError, match="only 0 indicators"):
        snapshot.run(tmp_path / "snap", now=NOW, min_indicators=1)
    assert not (tmp_path / "snap").exists()


def test_cli_exit_codes(tmp_path, fakes, monkeypatch):
    assert snapshot.main_cli(["--out", str(tmp_path / "ok"), "--min-indicators", "5"]) == 0
    assert (tmp_path / "ok" / "meta.json").exists()
    assert snapshot.main_cli(["--out", str(tmp_path / "thin"), "--min-indicators", "9999"]) == 1
    assert not (tmp_path / "thin").exists()


def test_fixture_snapshot_cli_marks_source_fixture(tmp_path):
    assert fixture_snapshot.main(["--out", str(tmp_path / "fx"), "--end", END.isoformat()]) == 0
    meta = json.loads((tmp_path / "fx" / "meta.json").read_text())
    assert meta["source"] == "fixture"
    assert meta["fredEnabled"] is True
    inds = json.loads((tmp_path / "fx" / "indicators.json").read_text())["indicators"]
    assert {i["asOf"] for i in inds if i["category"] == "Equities"} == {END.isoformat()}


# ---- fakes + cache floor -----------------------------------------------------
def test_fake_market_series_is_deterministic_and_anchored():
    a, b = market_series("^GSPC", END), market_series("^GSPC", END)
    assert a.equals(b)
    assert a.iloc[-1] == pytest.approx(6650.0)
    assert a.index[-1].date() == END
    spy = market_series("SPY", END)
    assert (spy.pct_change().dropna() - a.pct_change().dropna()).abs().max() < 1e-6


@pytest.mark.parametrize(("raw", "expected"), [(None, 0), ("3600", 3600), ("-5", 0), ("abc", 0)])
def test_cache_min_ttl_env(monkeypatch, raw, expected):
    if raw is None:
        monkeypatch.delenv("MACRO_CACHE_MIN_TTL", raising=False)
    else:
        monkeypatch.setenv("MACRO_CACHE_MIN_TTL", raw)
    assert cache.min_ttl() == expected


def test_cache_min_ttl_raises_bucket_ttl(monkeypatch):
    monkeypatch.setenv("MACRO_CACHE_MIN_TTL", "999")

    @cache.cached("snapshot-test-bucket", ttl=5)
    def f():
        return 1

    assert cache._caches["snapshot-test-bucket"].ttl == 999
