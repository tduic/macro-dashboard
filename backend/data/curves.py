"""Yield-curve snapshot.

The UST curve is the macro tape: shape (steep / flat / inverted), level,
front-vs-back moves. We build the curve point-by-point from the daily FRED
constant-maturity series, returning both the current curve and a small
comparison set (1w ago, 1m ago, 3m ago, prior YE) so the consumer can
overlay shifts.

Reuses the same _fetch_series + cache machinery from data/fred.py so
each tenor benefits from the 6h TTL.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Optional

import pandas as pd

from cache import cached
from data.fred import _fetch_series, has_fred_key

log = logging.getLogger("curves")

# (tenor label, tenor in years, FRED series_id)
UST_TENORS: list[tuple[str, float, str]] = [
    ("1M", 1 / 12, "DGS1MO"),
    ("3M", 0.25, "DGS3MO"),
    ("6M", 0.5, "DGS6MO"),
    ("1Y", 1.0, "DGS1"),
    ("2Y", 2.0, "DGS2"),
    ("3Y", 3.0, "DGS3"),
    ("5Y", 5.0, "DGS5"),
    ("7Y", 7.0, "DGS7"),
    ("10Y", 10.0, "DGS10"),
    ("20Y", 20.0, "DGS20"),
    ("30Y", 30.0, "DGS30"),
]


def _value_at_or_before(s: pd.Series, target: pd.Timestamp) -> Optional[float]:
    prior = s[s.index <= target]
    if prior.empty:
        return None
    return float(prior.iloc[-1])


@cached("fred", ttl=6 * 60 * 60)
def get_ust_curve() -> Optional[dict]:
    """Return current UST curve + a few historical snapshots, or None if no key."""
    if not has_fred_key():
        return None

    series_by_id: dict[str, pd.Series] = {}
    for _, _, sid in UST_TENORS:
        s = _fetch_series(sid)
        if s is not None and not s.empty:
            series_by_id[sid] = s

    if not series_by_id:
        return None

    # Anchor "as of" to the most recent date across all tenors.
    latest_date = max(s.index[-1] for s in series_by_id.values())
    as_of = latest_date.date().isoformat()

    snapshots: dict[str, pd.Timestamp] = {
        "current": latest_date,
        "1W": latest_date - pd.Timedelta(days=7),
        "1M": latest_date - pd.Timedelta(days=31),
        "3M": latest_date - pd.Timedelta(days=93),
        "YE": pd.Timestamp(f"{latest_date.year - 1}-12-31"),
    }

    def build_snapshot(target: pd.Timestamp) -> list[dict]:
        pts: list[dict] = []
        for label, years, sid in UST_TENORS:
            s = series_by_id.get(sid)
            if s is None:
                continue
            v = _value_at_or_before(s, target)
            if v is None:
                continue
            pts.append({"tenor": label, "tenorYears": years, "yield": round(v, 3)})
        return pts

    return {
        "asOf": as_of,
        "tenors": [t[0] for t in UST_TENORS],
        "curves": {name: build_snapshot(target) for name, target in snapshots.items()},
    }
