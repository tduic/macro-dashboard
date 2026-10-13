"""Offline tests for the network seams and route-level helpers in data/.

requests.get (FRED) and yfinance.Ticker (market) are replaced with fakes;
time.sleep is a no-op so throttles/retries cost nothing.
"""
import logging

import pandas as pd
import pytest

from data import fred, market


def bday_series(values, end="2026-06-05"):
    idx = pd.bdate_range(end=end, periods=len(values))
    return pd.Series([float(v) for v in values], index=idx)


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(fred.time, "sleep", lambda s: None)
    monkeypatch.setattr(market.time, "sleep", lambda s: None)


@pytest.fixture
def fred_key(monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "test-key")


@pytest.fixture
def no_fred_key(monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)


# ---- FRED key handling -------------------------------------------------------
def test_fred_key_is_stripped_and_blank_means_missing(monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", "  abc  ")
    assert fred.get_api_key() == "abc"
    assert fred.has_fred_key()
    monkeypatch.setenv("FRED_API_KEY", "   ")
    assert fred.get_api_key() is None
    assert not fred.has_fred_key()


# ---- FRED _fetch_series ------------------------------------------------------
def test_fetch_series_none_without_key(no_fred_key, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not call FRED without a key")

    monkeypatch.setattr(fred.requests, "get", boom)
    assert fred._fetch_series("DGS10") is None


def test_fetch_series_parses_sorts_and_skips_missing(fred_key, monkeypatch, fake_response):
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append((url, params, timeout))
        return fake_response(
            {
                "observations": [
                    {"date": "2026-06-03", "value": "4.40"},
                    {"date": "2026-06-01", "value": "4.30"},
                    {"date": "2026-06-02", "value": "."},  # FRED's missing marker
                    {"date": "2026-06-04", "value": ""},
                ]
            }
        )

    monkeypatch.setattr(fred.requests, "get", fake_get)
    s = fred._fetch_series("DGS10")
    assert list(s.index.strftime("%Y-%m-%d")) == ["2026-06-01", "2026-06-03"]
    assert list(s) == [4.30, 4.40]

    url, params, timeout = calls[0]
    assert url == f"{fred.FRED_BASE}/series/observations"
    assert params["series_id"] == "DGS10"
    assert params["api_key"] == "test-key"
    assert params["file_type"] == "json"
    assert "observation_start" in params
    assert timeout == 20


def test_fetch_series_is_cached_per_series(fred_key, monkeypatch, fake_response):
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(params["series_id"])
        return fake_response({"observations": [{"date": "2026-06-01", "value": "1"}]})

    monkeypatch.setattr(fred.requests, "get", fake_get)
    fred._fetch_series("A")
    fred._fetch_series("A")
    fred._fetch_series("B")
    assert calls == ["A", "B"]


def test_fetch_series_none_when_no_usable_rows(fred_key, monkeypatch, fake_response, caplog):
    monkeypatch.setattr(
        fred.requests, "get", lambda *a, **k: fake_response({"observations": [{"date": "2026-06-01", "value": "."}]})
    )
    with caplog.at_level(logging.WARNING, logger="fred"):
        assert fred._fetch_series("DGS10") is None
    assert "no usable observations" in caplog.text


def test_fetch_series_none_on_http_error(fred_key, monkeypatch, fake_response):
    monkeypatch.setattr(fred.requests, "get", lambda *a, **k: fake_response({}, status=500))
    assert fred._fetch_series("DGS10") is None


# ---- FRED builders and routes ------------------------------------------------
def test_build_rate_indicator_none_without_data(monkeypatch):
    monkeypatch.setattr(fred, "_fetch_series", lambda sid: None)
    assert fred.build_rate_indicator(fred.RATE_BY_ID["DGS10"]) is None
    monkeypatch.setattr(fred, "_fetch_series", lambda sid: pd.Series(dtype=float))
    assert fred.build_rate_indicator(fred.RATE_BY_ID["DGS10"]) is None
    assert fred.build_release_indicator(next(iter(fred.RELEASE_BY_ID.values()))) is None


def test_claims_use_percent_change_not_bps(monkeypatch):
    # Weekly claims: 220k -> 240k over ~1.5 years of Thursdays
    idx = pd.date_range(end="2026-06-04", periods=80, freq="W-THU")
    s = pd.Series([220_000.0 + 250 * i for i in range(80)], index=idx)
    monkeypatch.setattr(fred, "_fetch_series", lambda sid: s)
    ind = fred.build_rate_indicator(fred.RATE_BY_ID["ICSA"])
    assert ind["changeType"] == "pct"
    wow = ind["change"]["wow"]
    assert wow["abs"] == 250.0
    assert wow["pct"] == round(250 / (220_000 + 250 * 78) * 100, 2)
    assert ind["change"]["ytd"]["pct"] > 0


def test_claims_change_none_when_base_is_zero(monkeypatch):
    idx = pd.date_range(end="2026-06-04", periods=3, freq="W-THU")
    s = pd.Series([0.0, 0.0, 10.0], index=idx)
    monkeypatch.setattr(fred, "_fetch_series", lambda sid: s)
    ind = fred.build_rate_indicator(fred.RATE_BY_ID["ICSA"])
    assert ind["change"]["wow"] is None


def test_get_fred_indicators_empty_without_key(no_fred_key):
    assert fred.get_fred_indicators() == []


def test_get_fred_indicators_skips_failures_and_empties(fred_key, monkeypatch, caplog):
    first_rate, *_ = fred.RATE_SPECS
    first_release, *_ = fred.RELEASE_SPECS

    def rate(spec):
        if spec is first_rate:
            raise RuntimeError("bad series")
        return {"id": spec.id}

    def release(spec):
        return None if spec is first_release else {"id": spec.id}

    monkeypatch.setattr(fred, "build_rate_indicator", rate)
    monkeypatch.setattr(fred, "build_release_indicator", release)
    with caplog.at_level(logging.WARNING, logger="fred"):
        out = fred.get_fred_indicators()
    ids = [d["id"] for d in out]
    assert first_rate.id not in ids and first_release.id not in ids
    assert len(ids) == len(fred.RATE_SPECS) + len(fred.RELEASE_SPECS) - 2
    assert f"failed FRED rate {first_rate.id}" in caplog.text


def test_get_fred_history_unknown_id_is_none():
    assert fred.get_fred_history("NOPE", "1Y") is None


def test_get_fred_history_empty_without_key_or_data(no_fred_key, monkeypatch):
    assert fred.get_fred_history("DGS10", "1Y") == []
    monkeypatch.setenv("FRED_API_KEY", "k")
    monkeypatch.setattr(fred, "_fetch_series", lambda sid: None)
    assert fred.get_fred_history("DGS10", "1Y") == []


def test_get_fred_history_ranges(fred_key, monkeypatch):
    idx = pd.date_range("2025-12-20", "2026-01-10", freq="D")
    s = pd.Series(range(len(idx)), index=idx, dtype=float)
    monkeypatch.setattr(fred, "_fetch_series", lambda sid: s)

    ytd = fred.get_fred_history("DGS10", "YTD")
    assert ytd[0] == {"date": "2026-01-01", "value": 12.0}
    assert ytd[-1]["date"] == "2026-01-10"

    week = fred.get_fred_history("DGS10", "1W")
    assert [p["date"] for p in week][0] == "2026-01-03"
    assert len(week) == 8

    # unknown range falls back to 1Y -> whole (short) series
    assert len(fred.get_fred_history("DGS10", "bogus")) == len(s)


def test_broad_dollar_fallback(fred_key, monkeypatch):
    s = bday_series([100.0 + i * 0.1 for i in range(300)])
    monkeypatch.setattr(fred, "_fetch_series", lambda sid: s if sid == "DTWEXBGS" else None)
    ind = fred.get_broad_dollar_fallback()
    assert ind["id"] == "DXY"
    assert ind["source"] == "FRED:DTWEXBGS"
    assert ind["changeType"] == "pct"
    assert ind["change"]["wow"]["pct"] > 0
    assert ind["drawdown"] == {"pct": 0.0, "peakDate": "2026-06-05"}
    assert len(ind["sparkline"]) == 30


def test_broad_dollar_fallback_none_without_key_or_data(no_fred_key, monkeypatch):
    assert fred.get_broad_dollar_fallback() is None
    monkeypatch.setenv("FRED_API_KEY", "k")
    monkeypatch.setattr(fred, "_fetch_series", lambda sid: None)
    assert fred.get_broad_dollar_fallback() is None


def test_calendar_skips_malformed_dates(fred_key, monkeypatch, fake_response):
    today = pd.Timestamp.today().date().isoformat()
    monkeypatch.setattr(
        fred.requests,
        "get",
        lambda *a, **k: fake_response({"release_dates": [{"date": "not-a-date"}, {"date": None}, {"date": today}]}),
    )
    out = fred.get_calendar(days_ahead=7)
    assert out and all(item["releaseDate"] == today for item in out)


# ---- yfinance _download_series ------------------------------------------------
class FakeTicker:
    """yf.Ticker stand-in whose history() replays a queue of frames/exceptions."""

    script: list = []
    calls: list = []

    def __init__(self, ticker):
        self.ticker = ticker

    def history(self, **kwargs):
        FakeTicker.calls.append((self.ticker, kwargs))
        reply = FakeTicker.script.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


@pytest.fixture
def fake_yf(monkeypatch):
    FakeTicker.script = []
    FakeTicker.calls = []
    monkeypatch.setattr(market.yf, "Ticker", FakeTicker)
    return FakeTicker


def close_frame(values, tz="America/New_York"):
    idx = pd.date_range(end="2026-06-05", periods=len(values), freq="B", tz=tz)
    return pd.DataFrame({"Close": values, "Open": values}, index=idx)


def test_download_series_returns_tz_naive_closes(fake_yf):
    fake_yf.script = [close_frame([1.0, None, 3.0])]
    s = market._download_series("SPY")
    assert list(s) == [1.0, 3.0]  # NaN dropped
    assert s.index.tz is None
    assert fake_yf.calls[0] == ("SPY", {"period": "5y", "interval": "1d", "auto_adjust": False})


def test_download_series_retries_once_after_exception(fake_yf):
    fake_yf.script = [RuntimeError("timeout"), close_frame([5.0, 6.0])]
    assert list(market._download_series("SPY")) == [5.0, 6.0]
    assert len(fake_yf.calls) == 2


def test_download_series_retries_after_empty_frame(fake_yf):
    fake_yf.script = [pd.DataFrame(), close_frame([7.0])]
    assert list(market._download_series("SPY")) == [7.0]


def test_download_series_gives_up_after_two_attempts(fake_yf, caplog):
    fake_yf.script = [RuntimeError("a"), pd.DataFrame({"Open": [1.0]})]
    with caplog.at_level(logging.WARNING):
        assert market._download_series("SPY") is None
    assert len(fake_yf.calls) == 2


def test_download_series_all_nan_close_is_none(fake_yf):
    fake_yf.script = [close_frame([None, None]), close_frame([None])]
    assert market._download_series("SPY") is None


def test_resolve_series_falls_back_in_order(monkeypatch):
    spec = market.MarketSpec("X", "X", "FX", "PRIMARY", fallbacks=("FB1", "FB2"))
    seen = []
    data = {"FB2": bday_series([1.0, 2.0])}

    def fake_download(tk):
        seen.append(tk)
        return data.get(tk, pd.Series(dtype=float) if tk == "FB1" else None)

    monkeypatch.setattr(market, "_download_series", fake_download)
    s, used = market._resolve_series(spec)
    assert used == "FB2" and list(s) == [1.0, 2.0]
    assert seen == ["PRIMARY", "FB1", "FB2"]

    data.clear()
    s, used = market._resolve_series(spec)
    assert s is None and used == "PRIMARY"


# ---- market history / aggregation ---------------------------------------------
def test_get_market_history_unknown_and_empty(monkeypatch):
    assert market.get_market_history("NOPE", "1Y") is None
    monkeypatch.setattr(market, "_resolve_series", lambda spec: (None, spec.ticker))
    spec_id = market.MARKET_SPECS[0].id
    assert market.get_market_history(spec_id, "1Y") == []


def test_get_market_history_ranges(monkeypatch):
    idx = pd.date_range("2025-12-29", "2026-01-09", freq="B")
    s = pd.Series(range(len(idx)), index=idx, dtype=float)
    monkeypatch.setattr(market, "_resolve_series", lambda spec: (s, spec.ticker))
    spec_id = market.MARKET_SPECS[0].id

    ytd = market.get_market_history(spec_id, "YTD")
    assert ytd[0]["date"] == "2026-01-01"
    week = market.get_market_history(spec_id, "1W")
    assert [p["date"] for p in week] == ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]
    assert len(market.get_market_history(spec_id, "5Y")) == len(s)


def test_get_ratio_history(monkeypatch):
    assert market.get_ratio_history("NOPE", "1Y") is None
    ratio = market.RATIO_BY_ID["GOLD_SILVER"]
    a = bday_series([100.0, 110.0, 120.0])
    b = bday_series([10.0, 10.0, 0.0])  # zero denominator row dropped
    series = {ratio.a_id: a, ratio.b_id: b}
    monkeypatch.setattr(market, "_resolve_series", lambda spec: (series.get(spec.id), spec.ticker))
    hist = market.get_ratio_history("GOLD_SILVER", "YTD")
    assert [p["value"] for p in hist] == [10.0, 11.0]
    assert market.get_ratio_history("GOLD_SILVER", "1M") == hist

    series.clear()
    assert market.get_ratio_history("GOLD_SILVER", "1Y") == []


def test_get_market_indicators_skips_missing_and_failing(monkeypatch, caplog):
    first, second, *_ = market.MARKET_SPECS
    first_ratio, *_ = market.RATIO_SPECS

    def build(spec):
        if spec is first:
            return None
        if spec is second:
            raise RuntimeError("bad")
        return {"id": spec.id}

    def build_ratio(spec):
        if spec is first_ratio:
            raise RuntimeError("bad ratio")
        return {"id": spec.id}

    monkeypatch.setattr(market, "build_market_indicator", build)
    monkeypatch.setattr(market, "build_ratio_indicator", build_ratio)
    with caplog.at_level(logging.WARNING):
        out = market.get_market_indicators()
    ids = [d["id"] for d in out]
    assert first.id not in ids and second.id not in ids and first_ratio.id not in ids
    assert len(ids) == len(market.MARKET_SPECS) + len(market.RATIO_SPECS) - 3
    # ratios come after the underlying market cards
    assert ids.index(market.RATIO_SPECS[1].id) > ids.index(market.MARKET_SPECS[-1].id)
    assert f"skipping market indicator {first.id}" in caplog.text


def test_build_ratio_indicator_none_without_data(monkeypatch):
    monkeypatch.setattr(market, "_resolve_series", lambda spec: (None, spec.ticker))
    assert market.build_ratio_indicator(market.RATIO_SPECS[0]) is None
