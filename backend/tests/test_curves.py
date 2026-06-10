"""Offline tests for data/curves.py — UST curve snapshot construction with
_fetch_series monkeypatched. Tenor ordering, comparison-snapshot date
selection (1W/1M/3M/prior-YE), and missing-tenor tolerance.
"""
import pandas as pd
import pytest

from data import curves


ALL_TENOR_LABELS = ["1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]


def daily_series(start, end, value_fn):
    idx = pd.date_range(start, end, freq="D")
    return pd.Series([value_fn(ts) for ts in idx], index=idx)


def patch_curves(monkeypatch, series_by_id):
    monkeypatch.setattr(curves, "has_fred_key", lambda: True)
    monkeypatch.setattr(curves, "_fetch_series", lambda sid: series_by_id.get(sid))


def test_returns_none_without_key(monkeypatch):
    monkeypatch.setattr(curves, "has_fred_key", lambda: False)
    assert curves.get_ust_curve() is None


def test_returns_none_when_every_tenor_fails(monkeypatch):
    patch_curves(monkeypatch, {})
    assert curves.get_ust_curve() is None


def test_full_curve_tenor_ordering_and_shape(monkeypatch):
    # Flat-ish upward-sloping curve: each tenor = constant level by tenor rank.
    series = {
        sid: daily_series("2025-01-01", "2026-06-05", lambda ts, lvl=n: 3.0 + 0.1 * lvl)
        for n, (_, _, sid) in enumerate(curves.UST_TENORS)
    }
    patch_curves(monkeypatch, series)

    out = curves.get_ust_curve()
    assert out["asOf"] == "2026-06-05"
    assert out["tenors"] == ALL_TENOR_LABELS
    assert set(out["curves"]) == {"current", "1W", "1M", "3M", "YE"}

    cur = out["curves"]["current"]
    # points come back in front-to-back tenor order with increasing tenorYears
    assert [p["tenor"] for p in cur] == ALL_TENOR_LABELS
    years = [p["tenorYears"] for p in cur]
    assert years == sorted(years)
    assert cur[0]["yield"] == 3.0 and cur[-1]["yield"] == 4.0


def test_snapshot_date_selection(monkeypatch):
    # Encode the date into the value: yield = day-of-year / 1000 so we can
    # verify exactly which observation each snapshot picked.
    def by_date(ts):
        return ts.dayofyear / 1000 + (1.0 if ts.year == 2026 else 0.0)

    series = {sid: daily_series("2025-01-01", "2026-06-05", by_date)
              for _, _, sid in curves.UST_TENORS}
    patch_curves(monkeypatch, series)

    out = curves.get_ust_curve()
    c = {name: pts[0]["yield"] for name, pts in out["curves"].items()}
    # latest = 2026-06-05 (doy 156); 1W back = 05-29 (doy 149);
    # 1M = 31d back = 05-05 (doy 125); 3M = 93d back = 03-04 (doy 63);
    # YE = at-or-before 2025-12-31 (doy 365, prior year -> no +1 offset).
    assert c["current"] == round(156 / 1000 + 1, 3)
    assert c["1W"] == round(149 / 1000 + 1, 3)
    assert c["1M"] == round(125 / 1000 + 1, 3)
    assert c["3M"] == round(63 / 1000 + 1, 3)
    assert c["YE"] == round(365 / 1000, 3)


def test_snapshot_snaps_to_prior_observation_over_gaps(monkeypatch):
    # Weekend-style gap: no observation exactly 7 days back -> use prior one.
    idx = pd.to_datetime(["2026-05-25", "2026-05-27", "2026-06-05"])
    s = pd.Series([4.10, 4.20, 4.30], index=idx)
    patch_curves(monkeypatch, {"DGS10": s})

    out = curves.get_ust_curve()
    snap_1w = {p["tenor"]: p["yield"] for p in out["curves"]["1W"]}
    # 1W target = 05-29 -> snaps back to 05-27
    assert snap_1w["10Y"] == 4.20


def test_missing_tenor_is_tolerated(monkeypatch):
    series = {sid: daily_series("2025-06-01", "2026-06-05", lambda ts: 4.0)
              for _, _, sid in curves.UST_TENORS}
    del series["DGS20"]  # 20Y discontinued / failed fetch
    patch_curves(monkeypatch, series)

    out = curves.get_ust_curve()
    cur_tenors = [p["tenor"] for p in out["curves"]["current"]]
    assert "20Y" not in cur_tenors
    assert cur_tenors == [t for t in ALL_TENOR_LABELS if t != "20Y"]
    # advertised tenor axis still lists the full set
    assert out["tenors"] == ALL_TENOR_LABELS


def test_tenor_missing_history_is_dropped_from_old_snapshots_only(monkeypatch):
    long = daily_series("2025-01-01", "2026-06-05", lambda ts: 4.0)
    # 30Y only exists for the last 3 days -> present in "current", absent in "3M"/"YE"
    short_idx = pd.date_range("2026-06-03", "2026-06-05", freq="D")
    short = pd.Series([4.9, 4.95, 5.0], index=short_idx)
    series = {sid: long for _, _, sid in curves.UST_TENORS}
    series["DGS30"] = short
    patch_curves(monkeypatch, series)

    out = curves.get_ust_curve()
    assert "30Y" in [p["tenor"] for p in out["curves"]["current"]]
    assert "30Y" not in [p["tenor"] for p in out["curves"]["3M"]]
    assert "30Y" not in [p["tenor"] for p in out["curves"]["YE"]]


def test_asof_anchors_to_most_recent_tenor(monkeypatch):
    fresh = daily_series("2025-06-01", "2026-06-05", lambda ts: 4.0)
    stale = daily_series("2025-06-01", "2026-06-03", lambda ts: 4.5)  # lags 2 days
    series = {sid: stale for _, _, sid in curves.UST_TENORS}
    series["DGS10"] = fresh
    patch_curves(monkeypatch, series)

    out = curves.get_ust_curve()
    assert out["asOf"] == "2026-06-05"
    # stale tenors still contribute their latest available print to "current"
    cur = {p["tenor"]: p["yield"] for p in out["curves"]["current"]}
    assert cur["2Y"] == 4.5 and cur["10Y"] == 4.0
