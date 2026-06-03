"""Macro event dates for chart overlays.

Two sources:
  1. Hardcoded FOMC rate-decision dates (the second day of each meeting).
     Public schedule from federalreserve.gov — update once a year.
  2. Past + future FRED release dates for the big macro prints
     (NFP, CPI, PPI, Retail Sales, PCE, GDP) — fetched per-release with the
     same /fred/release/dates endpoint used by the calendar.

Used by /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD which the chart modal
queries when an indicator is opened.
"""
from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from typing import Optional

import requests

from cache import cached
from data.fred import FRED_BASE, get_api_key

log = logging.getLogger("events")

# Rate-decision day of each FOMC meeting (the second of the two-day
# meeting). Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
FOMC_DATES: tuple[str, ...] = (
    "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12", "2024-07-31",
    "2024-09-18", "2024-11-07", "2024-12-18",
    "2025-01-29", "2025-03-19", "2025-04-30", "2025-06-18", "2025-07-30",
    "2025-09-17", "2025-10-29", "2025-12-10",
    "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29",
    "2026-09-16", "2026-10-28", "2026-12-16",
)

# FRED release_id -> (short tag, full name). Same ids as data/fred.py.
EVENT_RELEASES: dict[int, tuple[str, str]] = {
    50: ("NFP", "Employment Situation"),
    10: ("CPI", "CPI"),
    46: ("PPI", "PPI"),
    9: ("RETAIL", "Retail Sales"),
    54: ("PCE", "PCE"),
    53: ("GDP", "GDP"),
}


@cached("events", ttl=6 * 60 * 60)
def get_events(from_date: str, to_date: str) -> list[dict]:
    """Return [{date, type, label}] for all known macro events in [from, to].

    Dates are ISO YYYY-MM-DD strings. Sorted by (date, type).
    """
    out: list[dict] = []

    # FOMC — hardcoded
    for d in FOMC_DATES:
        if from_date <= d <= to_date:
            out.append({"date": d, "type": "FOMC", "label": "FOMC"})

    # FRED release dates — past + future inside the realtime window
    key = get_api_key()
    if key:
        for rid, (short, long_name) in EVENT_RELEASES.items():
            try:
                r = requests.get(
                    f"{FRED_BASE}/release/dates",
                    params={
                        "release_id": rid,
                        "api_key": key,
                        "file_type": "json",
                        "realtime_start": from_date,
                        "realtime_end": to_date,
                        "include_release_dates_with_no_data": "true",
                        "sort_order": "asc",
                    },
                    timeout=12,
                )
                r.raise_for_status()
                for rd in r.json().get("release_dates", []):
                    d = rd.get("date")
                    if d and from_date <= d <= to_date:
                        out.append({"date": d, "type": short, "label": short})
            except Exception as exc:  # noqa: BLE001
                log.warning("event fetch failed for release %s: %s", rid, exc)
            time.sleep(0.4)  # stay under FRED rate limits

    out.sort(key=lambda x: (x["date"], x["type"]))
    return out
