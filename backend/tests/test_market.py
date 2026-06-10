"""Offline tests for the change-math / derivation helpers in data/market.py.

All series are synthetic pandas Series — no network, no yfinance calls.
Network seams (_resolve_series) are monkeypatched where a builder needs them.
"""
import pandas as pd
import pytest

from data import market


def bday_series(values, end="2026-06-05"):
    """A business-day-indexed Series ending at `end` (a Friday by default)."""
    idx = pd.bdate_range(end=end, periods=len(values))
    return pd.Series([float(v) for v in values], index=idx)


# ---- WoW / MoM row-offset math ---------------------------------------------
def test_wow_is_five_rows_back():
    s = bday_series(range(100, 130))  # 100..129, last value 129
    assert market._value_n_rows_back(s, 5) == 124.0  # 5 trading rows back


def test_mom_is_twenty_one_rows_back():
    s = bday_series(range(100, 130))
    assert market._value_n_rows_back(s, 21) == 108.0


def test_rows_back_returns_none_when_series_too_short():
    s = bday_series([1, 2, 3])
    assert market._value_n_rows_back(s, 5) is None


# ---- YTD vs prior-year close ------------------------------------------------
def test_prior_year_close_picks_last_observation_of_prior_year():
    # Prior year ends mid-week with the 31st missing -> nearest prior obs wins.
    idx = pd.to_datetime(["2025-12-29", "2025-12-30", "2026-01-02", "2026-01-05"])
    s = pd.Series([10.0, 11.0, 12.0, 13.0], index=idx)
    assert market._prior_year_close(s) == 11.0  # 2025-12-30, not the 29th


def test_prior_year_close_none_when_no_prior_year_data():
    idx = pd.to_datetime(["2026-01-02", "2026-01-05"])
    s = pd.Series([1.0, 2.0], index=idx)
    assert market._prior_year_close(s) is None


# ---- _pct delta dict ----------------------------------------------------------
def test_pct_delta_math():
    d = market._pct(110.0, 100.0)
    assert d == {"abs": 10.0, "pct": 10.0}


def test_pct_delta_none_for_zero_or_missing_base():
    assert market._pct(110.0, None) is None
    assert market._pct(110.0, 0) is None


# ---- percentile rank ----------------------------------------------------------
def test_percentile_rank_at_high_and_low():
    up = bday_series(range(1, 101))  # last value is the max
    assert market._percentile_rank(up, 252, "1Y") == {"value": 100.0, "window": "1Y"}
    down = bday_series(range(100, 0, -1))  # last value is the min
    rank = market._percentile_rank(down, 252, "1Y")
    assert rank["value"] == 1.0  # only itself <= itself: 1/100


def test_percentile_rank_uses_trailing_window_only():
    # 100 high values long ago, then 252 low ones; rank must ignore the old highs
    s = bday_series([1000.0] * 100 + list(range(1, 253)))
    rank = market._percentile_rank(s, 252, "1Y")
    assert rank["value"] == 100.0


def test_percentile_rank_none_when_too_few_observations():
    assert market._percentile_rank(bday_series(range(5)), 252, "1Y") is None


# ---- drawdown vs trailing-1Y running max --------------------------------------
def test_drawdown_at_high_is_zero_pct():
    s = bday_series(range(1, 300))
    dd = market.compute_drawdown(s)
    assert dd["pct"] == 0.0
    assert dd["peakDate"] == s.index[-1].date().isoformat()


def test_drawdown_off_high():
    # peak 200 mid-series, current 180 -> -10%
    values = list(range(100, 201)) + list(range(199, 179, -1))
    s = bday_series(values)
    dd = market.compute_drawdown(s)
    assert dd["pct"] == -10.0
    peak_pos = values.index(200)
    assert dd["peakDate"] == s.index[peak_pos].date().isoformat()


def test_drawdown_window_excludes_peaks_older_than_one_year():
    # All-time high of 500 set ~2y ago; trailing-1Y max is 200, current 150.
    old = pd.Series([500.0], index=pd.to_datetime(["2024-06-01"]))
    recent_idx = pd.bdate_range(end="2026-06-05", periods=100)
    recent = pd.Series([200.0] + [150.0] * 99, index=recent_idx)
    s = pd.concat([old, recent])
    dd = market.compute_drawdown(s)
    assert dd["pct"] == -25.0  # vs 200, not vs the stale 500


def test_drawdown_none_for_tiny_or_nonpositive_series():
    assert market.compute_drawdown(None) is None
    assert market.compute_drawdown(bday_series([1.0])) is None
    assert market.compute_drawdown(bday_series([-2.0, -1.0])) is None  # spread-like


# ---- full market indicator payload (network seam stubbed) ----------------------
@pytest.fixture
def spy_series():
    # 300 business days climbing 100 -> 399, then a 5% pullback on the last day
    values = list(range(100, 400))
    values[-1] = 399 * 0.95
    return bday_series(values)


def test_build_market_indicator_payload(monkeypatch, spy_series):
    monkeypatch.setattr(market, "_resolve_series", lambda spec: (spy_series, spec.ticker))
    ind = market.build_market_indicator(market.MARKET_BY_ID["SPY"])
    assert ind["id"] == "SPY"
    assert ind["changeType"] == "pct"
    assert ind["value"] == round(399 * 0.95, 4)
    assert ind["asOf"] == spy_series.index[-1].date().isoformat()
    # WoW base = 5 rows back = 394
    assert ind["change"]["wow"]["abs"] == round(399 * 0.95 - 394, 4)
    assert len(ind["sparkline"]) == market.SPARKLINE_DAILY_POINTS
    # drawdown vs the 398 peak (one row before the pullback)
    assert ind["drawdown"]["pct"] == round((399 * 0.95 / 398 - 1) * 100, 2)
    assert ind["drawdown"]["peakDate"] == spy_series.index[-2].date().isoformat()


def test_build_market_indicator_none_when_no_data(monkeypatch):
    monkeypatch.setattr(market, "_resolve_series", lambda spec: (None, spec.ticker))
    assert market.build_market_indicator(market.MARKET_BY_ID["SPY"]) is None


# ---- ratio derivation -----------------------------------------------------------
def test_ratio_series_aligns_dates_and_drops_zero_denominator(monkeypatch):
    idx_a = pd.to_datetime(["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"])
    idx_b = pd.to_datetime(["2026-06-02", "2026-06-03", "2026-06-04"])
    gold = pd.Series([4000.0, 4100.0, 4200.0, 4300.0], index=idx_a)
    silver = pd.Series([50.0, 0.0, 43.0], index=idx_b)  # zero must be dropped

    def fake_resolve(spec):
        return {"GOLD": gold, "SILVER": silver}.get(spec.id), spec.ticker

    monkeypatch.setattr(market, "_resolve_series", fake_resolve)
    s = market._ratio_series(market.RATIO_BY_ID["GOLD_SILVER"])
    # 06-01 (no silver) and 06-03 (zero denom) dropped; two aligned rows remain
    assert list(s.index) == list(pd.to_datetime(["2026-06-02", "2026-06-04"]))
    assert s.iloc[0] == 4100.0 / 50.0
    assert s.iloc[-1] == 4300.0 / 43.0


def test_build_ratio_indicator_payload(monkeypatch):
    idx = pd.bdate_range(end="2026-06-05", periods=40)
    gold = pd.Series([2000.0] * 40, index=idx)
    silver = pd.Series([25.0] * 39 + [20.0], index=idx)  # ratio jumps 80 -> 100

    def fake_resolve(spec):
        return {"GOLD": gold, "SILVER": silver}.get(spec.id), spec.ticker

    monkeypatch.setattr(market, "_resolve_series", fake_resolve)
    ind = market.build_ratio_indicator(market.RATIO_BY_ID["GOLD_SILVER"])
    assert ind["value"] == 100.0
    assert ind["category"] == "Ratios"
    assert ind["source"] == "derived:GOLD/SILVER"
    assert ind["change"]["wow"] == {"abs": 20.0, "pct": 25.0}  # 100 vs 80
    assert ind["drawdown"]["pct"] == 0.0  # ratio is at its 1Y high
