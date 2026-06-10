"""Offline tests for the upcoming-release calendar in data/fred.py
(get_calendar). The FRED REST seam (requests.get) is monkeypatched.
"""
from datetime import date, timedelta

import pytest

from data import fred


TODAY = date.today()


def iso(days_from_today: int) -> str:
    return (TODAY + timedelta(days=days_from_today)).isoformat()


@pytest.fixture(autouse=True)
def _no_throttle(monkeypatch):
    monkeypatch.setattr(fred.time, "sleep", lambda s: None)


def patch_calendar(monkeypatch, fake_response, dates_by_release, key="test-key"):
    monkeypatch.setenv("FRED_API_KEY", key)

    def fake_get(url, params=None, timeout=None):
        assert url.endswith("/release/dates")
        dates = dates_by_release.get(params["release_id"], [])
        if isinstance(dates, Exception):
            raise dates
        return fake_response({"release_dates": [{"date": d} for d in dates]})

    monkeypatch.setattr(fred.requests, "get", fake_get)


def test_calendar_empty_without_key(monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    assert fred.get_calendar() == []


def test_calendar_window_filtering_and_sort(monkeypatch, fake_response):
    patch_calendar(monkeypatch, fake_response, {
        10: [iso(-1), iso(3), iso(15)],   # CPI: yesterday + beyond window dropped
        50: [iso(0), iso(14)],            # NFP: today and last day kept (inclusive)
        46: [iso(1)],                     # PPI
        180: ["not-a-date", iso(2)],      # malformed date tolerated
    })

    items = fred.get_calendar(days_ahead=14)
    assert [i["releaseDate"] for i in items] == [iso(0), iso(1), iso(2), iso(3), iso(14)]
    assert all(i["source"] == "FRED" for i in items)
    by_date = {i["releaseDate"]: i["name"] for i in items}
    assert by_date[iso(3)] == "CPI"
    assert by_date[iso(2)] == "Initial Jobless Claims (weekly)"


def test_calendar_respects_days_ahead(monkeypatch, fake_response):
    patch_calendar(monkeypatch, fake_response, {10: [iso(2), iso(6)]})
    items = fred.get_calendar(days_ahead=3)
    assert [i["releaseDate"] for i in items] == [iso(2)]


def test_calendar_dedupes_same_release_same_date(monkeypatch, fake_response):
    patch_calendar(monkeypatch, fake_response, {10: [iso(3), iso(3), iso(3)]})
    items = fred.get_calendar(days_ahead=14)
    assert len(items) == 1
    assert items[0] == {"name": "CPI", "releaseDate": iso(3), "source": "FRED"}


def test_calendar_one_failing_release_is_skipped(monkeypatch, fake_response):
    patch_calendar(monkeypatch, fake_response, {
        10: RuntimeError("FRED 500"),
        50: [iso(4)],
    })
    items = fred.get_calendar(days_ahead=14)
    assert [(i["name"], i["releaseDate"]) for i in items] == [
        ("Employment Situation (NFP / Unemployment)", iso(4)),
    ]


def test_calendar_queries_every_configured_release(monkeypatch, fake_response):
    seen: list[int] = []
    monkeypatch.setenv("FRED_API_KEY", "test-key")

    def fake_get(url, params=None, timeout=None):
        seen.append(params["release_id"])
        return fake_response({"release_dates": []})

    monkeypatch.setattr(fred.requests, "get", fake_get)
    assert fred.get_calendar(days_ahead=14) == []
    assert sorted(seen) == sorted(fred.CALENDAR_RELEASES)
