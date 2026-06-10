"""API-layer tests: every route in main.py via FastAPI TestClient with the
data layer monkeypatched. Asserts the response contracts documented in the
README / mirrored in frontend/src/types.ts.
"""
import pytest
from fastapi.testclient import TestClient

import cache
import main
from data import curves as curves_data
from data import events as events_data
from data import fred, market, news


@pytest.fixture
def client():
    return TestClient(main.app)


def sample_indicator(id="SPY", category="Equities", **over):
    ind = {
        "id": id,
        "label": id,
        "category": category,
        "value": 600.25,
        "unit": "$",
        "asOf": "2026-06-05",
        "changeType": "pct",
        "source": f"yfinance:{id}",
        "change": {
            "wow": {"abs": 6.0, "pct": 1.01},
            "mom": {"abs": 12.0, "pct": 2.04},
            "ytd": {"abs": 30.0, "pct": 5.26},
        },
        "sparkline": [590.0, 595.0, 600.25],
        "percentile": {"value": 88.0, "window": "1Y"},
        "drawdown": {"pct": -1.2, "peakDate": "2026-05-28"},
    }
    ind.update(over)
    return ind


@pytest.fixture
def stub_data(monkeypatch):
    """Default happy-path stubs for every data-layer seam main.py touches."""
    monkeypatch.setattr(market, "get_market_indicators",
                        lambda: [sample_indicator("SPY"), sample_indicator("DXY", "FX")])
    monkeypatch.setattr(fred, "get_fred_indicators", lambda: [])
    monkeypatch.setattr(fred, "has_fred_key", lambda: True)
    monkeypatch.setattr(fred, "get_broad_dollar_fallback", lambda: None)
    monkeypatch.setattr(market, "get_market_history", lambda i, r: None)
    monkeypatch.setattr(market, "get_ratio_history", lambda i, r: None)
    monkeypatch.setattr(fred, "get_fred_history", lambda i, r: None)


# ---- /api/health and /api/meta -------------------------------------------------
def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "time" in body


def test_meta_shape(client, monkeypatch):
    monkeypatch.setattr(fred, "has_fred_key", lambda: True)
    r = client.get("/api/meta")
    assert r.status_code == 200
    body = r.json()
    assert body["fredEnabled"] is True
    assert body["categories"] == main.CATEGORY_ORDER
    assert "lastRefreshed" in body


def test_meta_reports_fred_disabled(client, monkeypatch):
    monkeypatch.setattr(fred, "has_fred_key", lambda: False)
    assert client.get("/api/meta").json()["fredEnabled"] is False


# ---- /api/indicators -------------------------------------------------------------
def test_indicators_response_contract(client, stub_data):
    r = client.get("/api/indicators")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"asOf", "fredEnabled", "count", "indicators"}
    assert body["count"] == len(body["indicators"]) == 2

    ind = body["indicators"][0]
    # documented card shape
    for key in ("id", "label", "category", "value", "unit", "asOf",
                "changeType", "source", "change", "sparkline",
                "percentile", "drawdown"):
        assert key in ind, f"missing {key}"
    assert set(ind["change"]) == {"wow", "mom", "ytd"}
    assert set(ind["change"]["wow"]) == {"abs", "pct"}
    assert set(ind["drawdown"]) == {"pct", "peakDate"}
    assert set(ind["percentile"]) == {"value", "window"}
    assert isinstance(ind["sparkline"], list)


def test_indicators_sorted_by_category_order(client, monkeypatch, stub_data):
    scrambled = [
        sample_indicator("BTC", "Crypto"),
        sample_indicator("DGS10", "Rates", changeType="bps"),
        sample_indicator("SPY", "Equities"),
    ]
    monkeypatch.setattr(market, "get_market_indicators", lambda: scrambled)
    cats = [i["category"] for i in client.get("/api/indicators").json()["indicators"]]
    assert cats == ["Equities", "Rates", "Crypto"]


def test_indicators_merges_fred_cards(client, monkeypatch, stub_data):
    monkeypatch.setattr(fred, "get_fred_indicators",
                        lambda: [sample_indicator("CPIAUCSL", "Economic Data")])
    ids = {i["id"] for i in client.get("/api/indicators").json()["indicators"]}
    assert {"SPY", "DXY", "CPIAUCSL"} <= ids


def test_indicators_dxy_fallback_used_when_missing(client, monkeypatch, stub_data):
    monkeypatch.setattr(market, "get_market_indicators", lambda: [sample_indicator("SPY")])
    monkeypatch.setattr(fred, "get_broad_dollar_fallback",
                        lambda: sample_indicator("DXY", "FX", source="FRED:DTWEXBGS"))
    inds = client.get("/api/indicators").json()["indicators"]
    dxy = next(i for i in inds if i["id"] == "DXY")
    assert dxy["source"] == "FRED:DTWEXBGS"


def test_indicators_dxy_fallback_not_used_when_present(client, monkeypatch, stub_data):
    monkeypatch.setattr(fred, "get_broad_dollar_fallback",
                        lambda: (_ for _ in ()).throw(AssertionError("must not be called")))
    ids = [i["id"] for i in client.get("/api/indicators").json()["indicators"]]
    assert ids.count("DXY") == 1


# ---- /api/indicators/{id}/history -------------------------------------------------
POINTS = [{"date": "2026-06-04", "value": 1.0}, {"date": "2026-06-05", "value": 2.0}]


@pytest.mark.parametrize("rng", ["1W", "1M", "3M", "6M", "YTD", "1Y", "5Y"])
def test_history_all_valid_ranges(client, monkeypatch, stub_data, rng):
    monkeypatch.setattr(market, "get_market_history",
                        lambda i, r: POINTS if (i, r) == ("SPY", rng) else None)
    r = client.get(f"/api/indicators/SPY/history?range={rng}")
    assert r.status_code == 200
    assert r.json() == {"id": "SPY", "range": rng, "points": POINTS}


def test_history_range_is_case_insensitive(client, monkeypatch, stub_data):
    monkeypatch.setattr(market, "get_market_history",
                        lambda i, r: POINTS if r == "1Y" else None)
    assert client.get("/api/indicators/SPY/history?range=1y").json()["range"] == "1Y"


def test_history_defaults_to_1y(client, monkeypatch, stub_data):
    monkeypatch.setattr(market, "get_market_history",
                        lambda i, r: POINTS if r == "1Y" else None)
    assert client.get("/api/indicators/SPY/history").json()["range"] == "1Y"


def test_history_invalid_range_400(client, stub_data):
    r = client.get("/api/indicators/SPY/history?range=2W")
    assert r.status_code == 400
    assert "invalid range" in r.json()["detail"]


def test_history_unknown_id_404(client, stub_data):
    r = client.get("/api/indicators/NOPE/history?range=1Y")
    assert r.status_code == 404
    assert "NOPE" in r.json()["detail"]


def test_history_falls_through_market_ratio_fred(client, monkeypatch, stub_data):
    calls: list[str] = []
    monkeypatch.setattr(market, "get_market_history",
                        lambda i, r: calls.append("market") or None)
    monkeypatch.setattr(market, "get_ratio_history",
                        lambda i, r: calls.append("ratio") or None)
    monkeypatch.setattr(fred, "get_fred_history",
                        lambda i, r: (calls.append("fred"), POINTS)[1])
    r = client.get("/api/indicators/CPIAUCSL/history?range=5Y")
    assert r.status_code == 200
    assert calls == ["market", "ratio", "fred"]
    assert r.json()["points"] == POINTS


# ---- /api/news ----------------------------------------------------------------------
def test_news_endpoint_contract(client, monkeypatch):
    items = [{
        "title": "Powell speaks", "source": "CNBC", "url": "https://x/1",
        "publishedAt": "2026-06-05T12:00:00+00:00", "category": "Markets",
        "topics": ["Fed"],
    }]
    monkeypatch.setattr(news, "get_news", lambda: items)
    body = client.get("/api/news").json()
    assert set(body) == {"asOf", "count", "items"}
    assert body["count"] == 1
    assert body["items"] == items


# ---- /api/calendar ---------------------------------------------------------------------
def test_calendar_disabled_without_key(client, monkeypatch):
    monkeypatch.setattr(fred, "has_fred_key", lambda: False)
    assert client.get("/api/calendar").json() == {"enabled": False, "items": []}


def test_calendar_enabled_with_key(client, monkeypatch):
    items = [{"name": "CPI", "releaseDate": "2026-06-10", "source": "FRED"}]
    monkeypatch.setattr(fred, "has_fred_key", lambda: True)
    monkeypatch.setattr(fred, "get_calendar", lambda days_ahead: items)
    body = client.get("/api/calendar").json()
    assert body == {"enabled": True, "count": 1, "items": items}


# ---- /api/curves/ust --------------------------------------------------------------------
def test_curves_disabled_when_no_data(client, monkeypatch):
    monkeypatch.setattr(curves_data, "get_ust_curve", lambda: None)
    assert client.get("/api/curves/ust").json() == {"enabled": False, "curves": {}}


def test_curves_payload_passthrough(client, monkeypatch):
    payload = {
        "asOf": "2026-06-05",
        "tenors": ["2Y", "10Y"],
        "curves": {"current": [{"tenor": "2Y", "tenorYears": 2.0, "yield": 3.9}]},
    }
    monkeypatch.setattr(curves_data, "get_ust_curve", lambda: payload)
    body = client.get("/api/curves/ust").json()
    assert body["enabled"] is True
    assert body["asOf"] == "2026-06-05"
    assert body["curves"] == payload["curves"]


# ---- /api/events ------------------------------------------------------------------------
def test_events_requires_from_and_to(client):
    assert client.get("/api/events").status_code == 422
    assert client.get("/api/events?from=2026-06-01").status_code == 422
    assert client.get("/api/events?to=2026-06-30").status_code == 422


def test_events_contract(client, monkeypatch):
    evts = [{"date": "2026-06-17", "type": "FOMC", "label": "FOMC"}]
    monkeypatch.setattr(events_data, "get_events", lambda f, t: evts)
    body = client.get("/api/events?from=2026-06-01&to=2026-06-30").json()
    assert body == {"from": "2026-06-01", "to": "2026-06-30", "count": 1, "events": evts}


# ---- POST /api/refresh -------------------------------------------------------------------
def test_refresh_clears_caches(client, monkeypatch):
    cleared = []
    monkeypatch.setattr(cache, "clear_all", lambda: cleared.append(True))
    body = client.post("/api/refresh").json()
    assert body["status"] == "cleared"
    assert "time" in body
    assert cleared == [True]


def test_refresh_rejects_get(client):
    assert client.get("/api/refresh").status_code == 405
