"""Offline tests for the change-math helpers in data/fred.py.

All series are synthetic pandas Series — no network, no FRED key needed.
The cached fetch seam (_fetch_series) is monkeypatched for builder tests.
"""
import pandas as pd
import pytest

from data import fred


def daily_weekday_series(values, end="2026-06-05"):
    idx = pd.bdate_range(end=end, periods=len(values))
    return pd.Series([float(v) for v in values], index=idx)


# ---- nearest-prior-observation snapping ---------------------------------------
def test_nearest_back_snaps_over_weekend_gap():
    # last obs Tue 2026-06-09; 2 days back = Sun 06-07 -> snaps to Fri 06-05
    idx = pd.to_datetime(["2026-06-04", "2026-06-05", "2026-06-08", "2026-06-09"])
    s = pd.Series([1.0, 2.0, 3.0, 4.0], index=idx)
    assert fred._nearest_back(s, 2) == 2.0  # Friday's value


def test_nearest_back_snaps_over_data_gap():
    # 7-day lookback lands inside a 10-day hole -> takes obs before the hole
    idx = pd.to_datetime(["2026-05-20", "2026-05-22", "2026-06-05"])
    s = pd.Series([10.0, 11.0, 12.0], index=idx)
    assert fred._nearest_back(s, 7) == 11.0  # 2026-05-29 target -> 05-22


def test_nearest_back_none_when_no_prior_observation():
    s = pd.Series([5.0], index=pd.to_datetime(["2026-06-05"]))
    assert fred._nearest_back(s, 7) is None


def test_prior_year_value_picks_last_print_of_prior_year():
    idx = pd.to_datetime(["2025-11-01", "2025-12-01", "2026-01-01", "2026-05-01"])
    s = pd.Series([310.0, 312.0, 313.0, 320.0], index=idx)
    assert fred._prior_year_value(s) == 312.0


# ---- bps math for yields -------------------------------------------------------
def test_bps_math_for_percent_valued_series():
    # 4.50% -> 4.62%: +12bps, pct slot is null by design
    assert fred._bps(4.62, 4.50) == {"abs": 12.0, "pct": None}
    assert fred._bps(4.38, 4.50) == {"abs": -12.0, "pct": None}
    assert fred._bps(4.62, None) is None


# ---- percentile ------------------------------------------------------------------
def test_series_percentile_matches_rank_definition():
    s = daily_weekday_series(list(range(1, 51)) + [25.5])
    rank = fred._series_percentile(s, 252, "1Y")
    # 26 of 51 window values <= 25.5 (1..25 plus itself) -> 51.0
    assert rank == {"value": 51.0, "window": "1Y"}


def test_series_percentile_none_on_short_series():
    assert fred._series_percentile(daily_weekday_series(range(5)), 252, "1Y") is None


# ---- rate indicator payload (yields: bps, no drawdown) ---------------------------
def test_build_rate_indicator_uses_bps_and_omits_drawdown(monkeypatch):
    # ~1y of a 10Y yield drifting 4.00 -> 4.50, weekend-gapped index
    s = daily_weekday_series([4.0 + i * 0.002 for i in range(252)])
    monkeypatch.setattr(fred, "_fetch_series", lambda sid: s)
    ind = fred.build_rate_indicator(fred.RATE_BY_ID["DGS10"])
    assert ind["changeType"] == "bps"
    assert ind["change"]["wow"]["pct"] is None
    # 7 calendar days back over a weekend = 5 trading rows = 5 * 0.2bps steps
    assert ind["change"]["wow"]["abs"] == 1.0
    assert "drawdown" not in ind  # meaningless for yields — must not appear


def test_build_release_indicator_prior_print_and_yoy(monkeypatch):
    # 25 monthly CPI prints, +0.5 idx pts per month
    idx = pd.date_range("2024-05-01", periods=25, freq="MS")
    s = pd.Series([300.0 + 0.5 * i for i in range(25)], index=idx)
    monkeypatch.setattr(fred, "_fetch_series", lambda sid: s)
    ind = fred.build_release_indicator(fred.RELEASE_BY_ID["CPIAUCSL"])
    assert ind["changeType"] == "pct"
    # "wow" slot = vs prior print
    assert ind["change"]["wow"]["abs"] == 0.5
    assert ind["meta"]["priorPrint"] == 311.5
    # "ytd" slot = YoY: last print of prior year is 2025-12-01 (index 19)
    yoy_base = 300.0 + 0.5 * 19
    assert ind["change"]["ytd"]["abs"] == round(312.0 - yoy_base, 2)
    assert ind["meta"]["changeLabels"] == {"wow": "vs prior", "ytd": "YoY"}
    assert "drawdown" not in ind  # meaningless for monthly releases
