"""Offline tests for data/events.py — FOMC window filtering, FRED release-date
merging (requests monkeypatched), and output ordering.
"""
import pytest

from data import events


@pytest.fixture(autouse=True)
def _no_throttle(monkeypatch):
    monkeypatch.setattr(events.time, "sleep", lambda s: None)


@pytest.fixture
def no_fred_key(monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)


# ---- FOMC date filtering ------------------------------------------------------
def test_fomc_dates_inside_window_only(no_fred_key):
    out = events.get_events("2026-06-01", "2026-09-30")
    assert out == [
        {"date": "2026-06-17", "type": "FOMC", "label": "FOMC"},
        {"date": "2026-07-29", "type": "FOMC", "label": "FOMC"},
        {"date": "2026-09-16", "type": "FOMC", "label": "FOMC"},
    ]


def test_fomc_2027_dates_are_present(no_fred_key):
    out = events.get_events("2027-01-01", "2027-12-31")
    assert [e["date"] for e in out] == [
        "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09",
        "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
    ]
    assert all(e["type"] == "FOMC" for e in out)


def test_window_boundaries_are_inclusive(no_fred_key):
    out = events.get_events("2026-06-17", "2026-06-17")
    assert out == [{"date": "2026-06-17", "type": "FOMC", "label": "FOMC"}]


def test_empty_window_yields_no_events(no_fred_key):
    assert events.get_events("2026-06-18", "2026-06-20") == []


# ---- FRED release-date merge ----------------------------------------------------
def fred_dates_payload(dates):
    return {"release_dates": [{"date": d} for d in dates]}


def test_merges_fred_release_dates_and_sorts(monkeypatch, fake_response):
    monkeypatch.setenv("FRED_API_KEY", "test-key")

    by_release = {
        50: ["2026-06-05"],                 # NFP
        10: ["2026-06-10", "2026-07-15"],   # CPI (07-15 outside window)
        46: [],                             # PPI: nothing
        9: ["2026-06-17"],                  # RETAIL, same day as FOMC
        54: ["2026-05-30"],                 # PCE before window
        53: [None],                         # GDP: missing date field tolerated
    }

    def fake_get(url, params=None, timeout=None):
        assert url.endswith("/release/dates")
        assert params["api_key"] == "test-key"
        assert params["realtime_start"] == "2026-06-01"
        assert params["realtime_end"] == "2026-06-30"
        return fake_response(fred_dates_payload(by_release[params["release_id"]]))

    monkeypatch.setattr(events.requests, "get", fake_get)

    out = events.get_events("2026-06-01", "2026-06-30")
    assert out == [
        {"date": "2026-06-05", "type": "NFP", "label": "NFP"},
        {"date": "2026-06-10", "type": "CPI", "label": "CPI"},
        # 06-17: FOMC sorts before RETAIL (tie broken by type)
        {"date": "2026-06-17", "type": "FOMC", "label": "FOMC"},
        {"date": "2026-06-17", "type": "RETAIL", "label": "RETAIL"},
    ]


def test_one_failing_release_doesnt_break_the_rest(monkeypatch, fake_response):
    monkeypatch.setenv("FRED_API_KEY", "test-key")

    def fake_get(url, params=None, timeout=None):
        if params["release_id"] == 10:  # CPI request blows up
            raise RuntimeError("FRED timeout")
        if params["release_id"] == 50:
            return fake_response(fred_dates_payload(["2026-06-05"]))
        return fake_response(fred_dates_payload([]))

    monkeypatch.setattr(events.requests, "get", fake_get)

    out = events.get_events("2026-06-01", "2026-06-16")
    assert out == [{"date": "2026-06-05", "type": "NFP", "label": "NFP"}]


def test_no_key_skips_fred_entirely(monkeypatch, no_fred_key):
    def boom(*a, **k):
        raise AssertionError("requests.get must not be called without a key")

    monkeypatch.setattr(events.requests, "get", boom)
    out = events.get_events("2026-06-01", "2026-06-30")
    assert out == [{"date": "2026-06-17", "type": "FOMC", "label": "FOMC"}]
