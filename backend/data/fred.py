"""FRED-backed data: rate series, economic releases, and the release calendar.

Everything here degrades gracefully when FRED_API_KEY is missing:
  * has_fred_key() lets the app surface a banner and hide FRED-only panels.
  * Every fetch is wrapped; one bad series logs and is skipped, never 500s.

We use fredapi when a key is present. Two flavors of indicator:
  * RATE series (DGS2/10/30, T10Y2Y, DFF, ICSA): daily-ish, changes shown in
    basis points (these are percent-valued series, so 1.00 == 100bps).
  * RELEASE series (CPI, PCE, payrolls, etc.): monthly/quarterly levels where
    we surface latest print, prior print, and YoY change.

The calendar uses the FRED /fred/releases/dates REST endpoint to list upcoming
release dates for the releases backing the series above.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

import pandas as pd
import requests

from cache import cached

log = logging.getLogger("fred")

FRED_BASE = "https://api.stlouisfed.org/fred"


def get_api_key() -> Optional[str]:
    key = os.environ.get("FRED_API_KEY", "").strip()
    return key or None


def has_fred_key() -> bool:
    return get_api_key() is not None


# ---- Specs ----------------------------------------------------------------
@dataclass(frozen=True)
class RateSpec:
    id: str
    label: str
    series_id: str
    unit: str = "%"


@dataclass(frozen=True)
class ReleaseSpec:
    id: str
    label: str
    series_id: str
    unit: str = ""
    # FRED release_id that this series belongs to (for the calendar).
    release_id: Optional[int] = None


# Rates (changes expressed in bps)
RATE_SPECS: list[RateSpec] = [
    RateSpec("DGS2", "2Y Treasury", "DGS2", unit="%"),
    RateSpec("DGS10", "10Y Treasury", "DGS10", unit="%"),
    RateSpec("DGS30", "30Y Treasury", "DGS30", unit="%"),
    RateSpec("T10Y2Y", "2s10s Spread", "T10Y2Y", unit="%"),
    # Inflation expectations & real rates — daily FRED series
    RateSpec("T10YIE", "10Y Breakeven (Inflation Exp.)", "T10YIE", unit="%"),
    RateSpec("DFII10", "10Y Real Yield (TIPS)", "DFII10", unit="%"),
    RateSpec("DFF", "Fed Funds (eff)", "DFF", unit="%"),
    RateSpec("ICSA", "Initial Claims", "ICSA", unit=""),
]
RATE_BY_ID = {s.id: s for s in RATE_SPECS}

# Economic releases (latest / prior / YoY). release_id values are the FRED
# release ids used by the calendar endpoint.
RELEASE_SPECS: list[ReleaseSpec] = [
    # release_id values verified live against /fred/series/release
    ReleaseSpec("CPIAUCSL", "CPI (headline)", "CPIAUCSL", unit="idx", release_id=10),
    ReleaseSpec("CPILFESL", "Core CPI", "CPILFESL", unit="idx", release_id=10),
    ReleaseSpec("PCEPI", "PCE", "PCEPI", unit="idx", release_id=54),
    ReleaseSpec("PCEPILFE", "Core PCE", "PCEPILFE", unit="idx", release_id=54),
    ReleaseSpec("PAYEMS", "Nonfarm Payrolls", "PAYEMS", unit="k", release_id=50),
    ReleaseSpec("UNRATE", "Unemployment Rate", "UNRATE", unit="%", release_id=50),
    ReleaseSpec("GDPC1", "Real GDP", "GDPC1", unit="bn$", release_id=53),
    ReleaseSpec("RSAFS", "Retail Sales", "RSAFS", unit="mn$", release_id=9),
    ReleaseSpec("PPIACO", "PPI (all)", "PPIACO", unit="idx", release_id=46),
]
RELEASE_BY_ID = {s.id: s for s in RELEASE_SPECS}

ALL_FRED_IDS = set(RATE_BY_ID) | set(RELEASE_BY_ID)

RANGE_DAYS = {
    "1W": 7, "1M": 31, "3M": 93, "6M": 186, "1Y": 366, "5Y": 5 * 366,
}


# ---- Low-level fetch (cached ~6h) -----------------------------------------
@cached("fred", ttl=6 * 60 * 60)
def _fetch_series(series_id: str) -> Optional[pd.Series]:
    """Fetch a full FRED series as a float Series indexed by date, or None."""
    key = get_api_key()
    if not key:
        return None
    try:
        # Use the REST observations endpoint directly (no extra dep beyond requests).
        params = {
            "series_id": series_id,
            "api_key": key,
            "file_type": "json",
            "observation_start": (date.today() - timedelta(days=6 * 366)).isoformat(),
        }
        r = requests.get(f"{FRED_BASE}/series/observations", params=params, timeout=20)
        r.raise_for_status()
        obs = r.json().get("observations", [])
        rows = [
            (pd.Timestamp(o["date"]), float(o["value"]))
            for o in obs
            if o.get("value") not in (".", "", None)
        ]
        if not rows:
            log.warning("FRED series %s returned no usable observations", series_id)
            return None
        idx, vals = zip(*rows)
        return pd.Series(vals, index=pd.DatetimeIndex(idx)).sort_index()
    except Exception as exc:  # noqa: BLE001
        log.warning("FRED fetch failed for %s: %s", series_id, exc)
        return None


def _nearest_back(s: pd.Series, days: int) -> Optional[float]:
    """Value at-or-before (last_date - days)."""
    if s.empty:
        return None
    target = s.index[-1] - pd.Timedelta(days=days)
    prior = s[s.index <= target]
    if prior.empty:
        return None
    return float(prior.iloc[-1])


def _prior_year_value(s: pd.Series) -> Optional[float]:
    if s.empty:
        return None
    year = s.index[-1].year
    prior = s[s.index.year < year]
    return float(prior.iloc[-1]) if not prior.empty else None


def _bps(curr: float, base: Optional[float]) -> Optional[dict]:
    """Change in basis points for percent-valued (yield) series."""
    if base is None:
        return None
    return {"abs": round((curr - base) * 100, 1), "pct": None}


def build_rate_indicator(spec: RateSpec) -> Optional[dict]:
    s = _fetch_series(spec.series_id)
    if s is None or s.empty:
        return None
    curr = float(s.iloc[-1])
    as_of = s.index[-1].date().isoformat()

    if spec.id == "ICSA":
        # claims is a level (thousands of people) -> percent change is meaningful
        def chg(base):
            if base in (None, 0):
                return None
            return {"abs": round(curr - base, 0), "pct": round((curr - base) / base * 100, 2)}
        change_type = "pct"
        change = {
            "wow": chg(_nearest_back(s, 7)),
            "mom": chg(_nearest_back(s, 31)),
            "ytd": chg(_prior_year_value(s)),
        }
    else:
        change_type = "bps"
        change = {
            "wow": _bps(curr, _nearest_back(s, 7)),
            "mom": _bps(curr, _nearest_back(s, 31)),
            "ytd": _bps(curr, _prior_year_value(s)),
        }

    spark = [round(float(v), 4) for v in s.iloc[-30:].tolist()]
    return {
        "id": spec.id,
        "label": spec.label,
        "category": "Rates",
        "value": round(curr, 3),
        "unit": spec.unit,
        "asOf": as_of,
        "changeType": change_type,
        "source": f"FRED:{spec.series_id}",
        "change": change,
        "sparkline": spark,
    }


def build_release_indicator(spec: ReleaseSpec) -> Optional[dict]:
    s = _fetch_series(spec.series_id)
    if s is None or s.empty:
        return None
    curr = float(s.iloc[-1])
    as_of = s.index[-1].date().isoformat()
    prior = float(s.iloc[-2]) if len(s) > 1 else None
    yoy_base = _prior_year_value(s)

    def pct(base):
        if base in (None, 0):
            return None
        return {"abs": round(curr - base, 2), "pct": round((curr - base) / base * 100, 2)}

    spark = [round(float(v), 4) for v in s.iloc[-12:].tolist()]
    return {
        "id": spec.id,
        "label": spec.label,
        "category": "Economic Data",
        "value": round(curr, 2),
        "unit": spec.unit,
        "asOf": as_of,
        "changeType": "pct",
        "source": f"FRED:{spec.series_id}",
        # For releases: "wow" slot carries change vs prior print, ytd carries YoY.
        "change": {
            "wow": pct(prior),       # vs prior print
            "mom": None,
            "ytd": pct(yoy_base),    # YoY
        },
        "meta": {"priorPrint": prior, "changeLabels": {"wow": "vs prior", "ytd": "YoY"}},
        "sparkline": spark,
    }


def get_fred_indicators() -> list[dict]:
    """All FRED-backed indicators (rates + releases). Empty if no key."""
    if not has_fred_key():
        return []
    out: list[dict] = []
    for spec in RATE_SPECS:
        try:
            ind = build_rate_indicator(spec)
            if ind:
                out.append(ind)
        except Exception as exc:  # noqa: BLE001
            log.warning("failed FRED rate %s: %s", spec.id, exc)
    for spec in RELEASE_SPECS:
        try:
            ind = build_release_indicator(spec)
            if ind:
                out.append(ind)
        except Exception as exc:  # noqa: BLE001
            log.warning("failed FRED release %s: %s", spec.id, exc)
    return out


def get_fred_history(spec_id: str, range_: str) -> Optional[list[dict]]:
    spec = RATE_BY_ID.get(spec_id) or RELEASE_BY_ID.get(spec_id)
    if spec is None:
        return None
    if not has_fred_key():
        return []
    s = _fetch_series(spec.series_id)
    if s is None or s.empty:
        return []
    if range_ == "YTD":
        year = s.index[-1].year
        sliced = s[s.index.year == year]
    else:
        days = RANGE_DAYS.get(range_, 366)
        cutoff = s.index[-1] - pd.Timedelta(days=days)
        sliced = s[s.index >= cutoff]
    return [
        {"date": idx.date().isoformat(), "value": round(float(v), 4)}
        for idx, v in sliced.items()
    ]


def get_broad_dollar_fallback() -> Optional[dict]:
    """FRED DTWEXBGS broad dollar index — used if yfinance DX-Y.NYB fails."""
    if not has_fred_key():
        return None
    s = _fetch_series("DTWEXBGS")
    if s is None or s.empty:
        return None
    curr = float(s.iloc[-1])

    def pct(base):
        if base in (None, 0):
            return None
        return {"abs": round(curr - base, 3), "pct": round((curr - base) / base * 100, 2)}

    spark = [round(float(v), 4) for v in s.iloc[-30:].tolist()]
    return {
        "id": "DXY",
        "label": "US Dollar Index (Broad, FRED)",
        "category": "FX",
        "value": round(curr, 3),
        "unit": "idx",
        "asOf": s.index[-1].date().isoformat(),
        "changeType": "pct",
        "source": "FRED:DTWEXBGS",
        "change": {
            "wow": pct(_nearest_back(s, 7)),
            "mom": pct(_nearest_back(s, 31)),
            "ytd": pct(_prior_year_value(s)),
        },
        "sparkline": spark,
    }


# Releases included in the economic calendar. Maps FRED release_id -> friendly
# name. Verified live against /fred/series/release and /fred/release/dates.
CALENDAR_RELEASES: dict[int, str] = {
    50: "Employment Situation (NFP / Unemployment)",
    10: "CPI",
    46: "Producer Price Index (PPI)",
    9: "Advance Retail Sales",
    54: "Personal Income & Outlays (PCE)",
    53: "GDP",
    180: "Initial Jobless Claims (weekly)",
}


# ---- Calendar -------------------------------------------------------------
@cached("calendar", ttl=6 * 60 * 60)
def get_calendar(days_ahead: int = 14) -> list[dict]:
    """Upcoming FRED release dates for the releases backing our series.

    Returns [{name, releaseDate, source}] sorted by date. Empty if no key.

    Implementation: queries /fred/release/dates once per unique release_id
    rather than the aggregate /fred/releases/dates (which returns *all*
    release dates ever and times out). Throttled to stay under FRED's
    120 req/min limit. Cached ~6h, so this only fires a few times a day.
    """
    if not has_fred_key():
        return []
    key = get_api_key()
    today = date.today()
    end = today + timedelta(days=days_ahead)

    out: list[dict] = []
    for rid, friendly_name in CALENDAR_RELEASES.items():
        try:
            r = requests.get(
                f"{FRED_BASE}/release/dates",
                params={
                    "release_id": rid,
                    "api_key": key,
                    "file_type": "json",
                    "realtime_start": today.isoformat(),
                    "realtime_end": end.isoformat(),
                    "include_release_dates_with_no_data": "true",
                    "sort_order": "asc",
                },
                timeout=12,
            )
            r.raise_for_status()
            for rd in r.json().get("release_dates", []):
                d = rd.get("date")
                if not d:
                    continue
                try:
                    dd = datetime.strptime(d, "%Y-%m-%d").date()
                except ValueError:
                    continue
                if today <= dd <= end:
                    out.append({
                        "name": friendly_name,
                        "releaseDate": dd.isoformat(),
                        "source": "FRED",
                    })
        except Exception as exc:  # noqa: BLE001
            log.warning("FRED calendar fetch failed for release %s: %s", rid, exc)
            continue
        time.sleep(0.4)  # stay well under 120 req/min

    # de-dupe (name, date) and sort by date
    seen: set[tuple[str, str]] = set()
    deduped: list[dict] = []
    for item in sorted(out, key=lambda x: x["releaseDate"]):
        k = (item["name"], item["releaseDate"])
        if k not in seen:
            seen.add(k)
            deduped.append(item)
    return deduped


