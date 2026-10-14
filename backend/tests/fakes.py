"""Deterministic fake upstreams (yfinance, FRED REST, RSS) for offline runs.

Used by the snapshot tests and by tests/fixture_snapshot.py, which renders a
complete static snapshot with no network so CI (and screenshots) can build
the public frontend. Everything here is synthetic: seeded random walks
anchored at plausible levels, generic headlines from "Fixture wire" feeds
pointing at example.com. None of it is market data.

    with fake_upstreams(end=date(2026, 10, 14)):
        ...  # yf.Ticker, requests.get (FRED) and feedparser.parse are faked
"""
from __future__ import annotations

import contextlib
import functools
import hashlib
import os
from calendar import timegm
from datetime import date, datetime, time as dtime, timedelta, timezone
from time import gmtime
from types import SimpleNamespace
from typing import Iterator, Optional

import numpy as np
import pandas as pd

from data import events, fred, market, news

YEARS = 5

# ticker -> (last level, annualised vol, equity beta)
MARKET_LEVELS: dict[str, tuple[float, float, float]] = {
    "^GSPC": (6650.0, 0.15, 1.0), "^IXIC": (22500.0, 0.20, 1.25),
    "^DJI": (46200.0, 0.14, 0.9), "^RUT": (2450.0, 0.22, 1.2),
    "SPY": (663.0, 0.15, 1.0), "QQQ": (600.0, 0.20, 1.25),
    "DIA": (462.0, 0.14, 0.9), "IWM": (243.0, 0.22, 1.2),
    "^VIX": (16.5, 0.0, 0.0),  # special-cased: mean-reverting
    "HYG": (80.5, 0.05, 0.3), "LQD": (110.0, 0.06, 0.05),
    "^FTSE": (9400.0, 0.13, 0.6), "^GDAXI": (24300.0, 0.17, 0.7),
    "^STOXX50E": (5550.0, 0.16, 0.7), "^N225": (47000.0, 0.20, 0.6),
    "^HSI": (26000.0, 0.24, 0.5), "000001.SS": (3850.0, 0.18, 0.2),
    "DX-Y.NYB": (98.5, 0.07, -0.1), "EURUSD=X": (1.165, 0.07, 0.1),
    "JPY=X": (151.0, 0.09, 0.1), "GBPUSD=X": (1.335, 0.08, 0.1),
    "CL=F": (61.0, 0.32, 0.3), "BZ=F": (65.0, 0.30, 0.3),
    "NG=F": (3.2, 0.55, 0.0), "GC=F": (4100.0, 0.15, 0.0),
    "SI=F": (50.0, 0.28, 0.1), "HG=F": (4.9, 0.22, 0.4),
    "ZC=F": (420.0, 0.22, 0.0), "ZW=F": (505.0, 0.26, 0.0),
    "ZS=F": (1010.0, 0.18, 0.0), "SB=F": (16.0, 0.28, 0.0),
    "KC=F": (380.0, 0.35, 0.0), "CC=F": (6200.0, 0.45, 0.0),
    "BTC-USD": (112000.0, 0.50, 0.8), "ETH-USD": (4100.0, 0.70, 1.0),
}

# A few deliberate last-day shocks so the >2 sigma flag and the mover strip
# have something to show.
LAST_DAY_SHOCK = {
    "NG=F": 0.072, "CC=F": -0.061, "^VIX": 0.09,
    "BTC-USD": 0.006, "ETH-USD": 0.011,
}

# FRED daily rate series: last level. The UST tenors share a level + slope
# factor so the curve and its 1W/1M/3M/YE overlays move coherently.
UST_LEVELS = {
    "DGS1MO": 4.02, "DGS3MO": 3.95, "DGS6MO": 3.80, "DGS1": 3.62, "DGS2": 3.52,
    "DGS3": 3.50, "DGS5": 3.62, "DGS7": 3.83, "DGS10": 4.08, "DGS20": 4.63,
    "DGS30": 4.66,
}
UST_YEARS = {
    "DGS1MO": 1 / 12, "DGS3MO": 0.25, "DGS6MO": 0.5, "DGS1": 1, "DGS2": 2, "DGS3": 3,
    "DGS5": 5, "DGS7": 7, "DGS10": 10, "DGS20": 20, "DGS30": 30,
}
OTHER_DAILY = {
    "T5YIE": 2.38, "T10YIE": 2.34, "T5YIFR": 2.28, "DFII10": 1.75,
    "IUDSOIA": 3.97, "DTWEXBGS": 120.4,
}
# policy rates: (last level, days-before-end at which each 25bp step happened)
POLICY = {"DFF": (4.09, (28, 120, 300, 360, 420)), "ECBDFR": (2.0, (130, 190, 250, 320))}
# monthly / quarterly releases: (last level, per-period drift, noise, freq)
RELEASES = {
    "CPIAUCSL": (324.4, 0.0025, 0.0008, "MS"), "CPILFESL": (330.5, 0.0026, 0.0006, "MS"),
    "PCEPI": (127.1, 0.0022, 0.0006, "MS"), "PCEPILFE": (126.3, 0.0023, 0.0005, "MS"),
    "PAYEMS": (159600.0, 0.0006, 0.0005, "MS"), "UNRATE": (4.3, 0.0, 0.02, "MS"),
    "GDPC1": (23770.0, 0.005, 0.003, "QS"), "RSAFS": (734000.0, 0.003, 0.004, "MS"),
    "PPIACO": (262.0, 0.002, 0.004, "MS"), "IR3TIB01JPM156N": (0.62, 0.0, 0.03, "MS"),
    "ICSA": (226000.0, 0.0, 0.05, "W-SAT"),
}

# FRED release_id -> day-of-month it "publishes" in the fake calendar.
# 180 (claims) is weekly on Thursdays; 50 (NFP) is the first Friday.
RELEASE_DAY = {10: 14, 46: 15, 9: 16, 54: 27, 53: 29}

HEADLINES: list[tuple[str, str]] = [
    ("Treasury yields slip ahead of inflation data", "Markets"),
    ("Natural gas jumps as cold-weather forecasts tighten supply outlook", "Markets"),
    ("Cocoa slides as West African harvest estimates improve", "Markets"),
    ("Stocks drift as investors weigh Fed rate path", "Markets"),
    ("Volatility index rises from multi-week low", "Markets"),
    ("Gold holds near highs as dollar softens", "Markets"),
    ("Crude oil steadies after weekly drop on supply worries", "Markets"),
    ("Fed officials signal patience on further rate cuts", "Economy"),
    ("CPI preview: economists expect core inflation to cool slightly", "Economy"),
    ("Jobless claims tick up but labor market remains resilient", "Economy"),
    ("Retail sales forecast to show steady consumer spending", "Economy"),
    ("Bitcoin consolidates after volatile week for crypto", "Markets"),
    ("China factory activity contracts for second month", "Economy"),
    ("European stocks close mixed as bond yields climb", "Markets"),
    ("Copper rises on hopes for stronger industrial demand", "Markets"),
    ("Dollar index slips against the euro and yen", "Markets"),
    ("Credit spreads stay tight as high-yield issuance picks up", "Markets"),
    ("GDP tracking estimates point to moderate growth", "Economy"),
    ("Wheat and corn futures fall on ample global supply", "Markets"),
    ("Japan bond yields rise as central bank policy debate continues", "Markets"),
]


def _seed(name: str) -> int:
    return int.from_bytes(hashlib.sha256(name.encode()).digest()[:4], "little")


@functools.lru_cache(maxsize=8)
def _bdays(end: date, years: int = YEARS) -> pd.DatetimeIndex:
    return pd.bdate_range(end=pd.Timestamp(end), periods=int(years * 261))


def _equity_factor(n: int) -> np.ndarray:
    rng = np.random.default_rng(_seed("equity-factor"))
    return rng.normal(0.0005, 0.011, n)


# ETF proxies track their index (same path, different scale).
ETF_TRACKS = {"SPY": "^GSPC", "QQQ": "^IXIC", "DIA": "^DJI", "IWM": "^RUT"}


def market_series(ticker: str, end: date) -> Optional[pd.Series]:
    """Daily closes ending at `end` (last value == the configured level)."""
    if ticker not in MARKET_LEVELS:
        return None
    if ticker in ETF_TRACKS:
        base = market_series(ETF_TRACKS[ticker], end)
        return (base / base.iloc[-1] * MARKET_LEVELS[ticker][0]).round(4)
    idx = _bdays(end)
    n = len(idx)
    rng = np.random.default_rng(_seed(ticker))
    last, vol, beta = MARKET_LEVELS[ticker]
    f = _equity_factor(n)
    if ticker == "^VIX":
        # log-OU around log(17), moving against the equity factor
        x = np.empty(n)
        x[0] = np.log(17.0)
        eps = rng.normal(0, 0.06, n) - 3.0 * f
        for i in range(1, n):
            x[i] = x[i - 1] + 0.04 * (np.log(17.0) - x[i - 1]) + eps[i]
        x[-1] = x[-2] + np.log1p(LAST_DAY_SHOCK.get(ticker, 0.0))
        levels = np.exp(x - x[-1]) * last
    else:
        daily = vol / np.sqrt(252)
        idio = np.sqrt(max(daily**2 - (beta * 0.011) ** 2, (daily * 0.3) ** 2))
        rets = beta * f + rng.normal(0.0002, idio, n)
        if ticker in LAST_DAY_SHOCK:
            rets[-1] = np.log1p(LAST_DAY_SHOCK[ticker])
        # walk backwards from the anchored last level
        logp = np.cumsum(rets)
        levels = last * np.exp(logp - logp[-1])
    return pd.Series(levels.round(6), index=idx)


def fred_series(series_id: str, end: date) -> Optional[pd.Series]:
    """Observations ending at `end` for a FRED series id."""
    rng = np.random.default_rng(_seed(series_id))
    if series_id in UST_LEVELS:
        idx = _bdays(end)
        n = len(idx)
        frng = np.random.default_rng(_seed("ust-factors"))
        level = np.cumsum(frng.normal(0, 0.045, n))
        slope = np.cumsum(frng.normal(0, 0.025, n))
        level -= level[-1]
        slope -= slope[-1]
        w = np.log1p(UST_YEARS[series_id]) / np.log1p(30)  # 0 at the front, 1 at 30Y
        noise = rng.normal(0, 0.004, n)
        vals = UST_LEVELS[series_id] + level + slope * (w - 0.5) + noise - noise[-1]
        return pd.Series(np.round(vals, 2), index=idx)
    if series_id == "T10Y2Y":
        s10, s2 = fred_series("DGS10", end), fred_series("DGS2", end)
        return (s10 - s2).round(2)
    if series_id in OTHER_DAILY:
        idx = _bdays(end)
        last = OTHER_DAILY[series_id]
        step = 0.003 * last if series_id == "DTWEXBGS" else 0.02
        walk = np.cumsum(rng.normal(0, step, len(idx)))
        return pd.Series(np.round(last + walk - walk[-1], 3), index=idx)
    if series_id in POLICY:
        idx = _bdays(end)
        last, steps = POLICY[series_id]
        vals = np.full(len(idx), last)
        for days_back in steps:
            vals[idx < pd.Timestamp(end) - pd.Timedelta(days=days_back)] += 0.25
        return pd.Series(np.round(vals, 2), index=idx)
    if series_id in RELEASES:
        last, drift, noise, freq = RELEASES[series_id]
        # latest print refers to ~6 weeks before `end` (releases lag)
        ref_end = pd.Timestamp(end) - pd.Timedelta(days=45 if freq != "W-SAT" else 5)
        periods = {"MS": YEARS * 12, "QS": YEARS * 4, "W-SAT": YEARS * 52}[freq]
        idx = pd.date_range(end=ref_end, periods=periods, freq=freq)
        if series_id in ("UNRATE", "IR3TIB01JPM156N"):
            walk = np.cumsum(rng.normal(0, noise, len(idx)))
            vals = last + walk - walk[-1]
        else:
            logv = np.cumsum(rng.normal(drift, noise, len(idx)))
            vals = last * np.exp(logv - logv[-1])
        return pd.Series(np.round(vals, 3), index=idx)
    return None


def release_dates(release_id: int, start: date, stop: date) -> list[str]:
    if release_id == 180:  # weekly claims: every Thursday in range
        days = (start + timedelta(days=i) for i in range((stop - start).days + 1))
        return [d.isoformat() for d in days if d.weekday() == 3]
    out: list[str] = []
    d = date(start.year, start.month, 1)
    while d <= stop:
        if release_id == 50:  # first Friday
            first = d
            while first.weekday() != 4:
                first += timedelta(days=1)
            cand = first
        elif release_id == 53 and d.month not in (1, 4, 7, 10):
            cand = None  # GDP advance estimate: quarterly
        else:
            cand = d.replace(day=RELEASE_DAY.get(release_id, 15))
        if cand and start <= cand <= stop:
            out.append(cand.isoformat())
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return out


class _Resp:
    def __init__(self, payload: dict, status: int = 200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


def make_fake_requests_get(end: date):
    def fake_get(url, params=None, timeout=None):
        params = params or {}
        if url.endswith("/series/observations"):
            s = fred_series(params["series_id"], end)
            if s is None:
                return _Resp({}, status=400)
            obs = [{"date": d.date().isoformat(), "value": f"{v}"} for d, v in s.items()]
            return _Resp({"observations": obs})
        if url.endswith("/release/dates"):
            start = date.fromisoformat(params["realtime_start"])
            stop = date.fromisoformat(params["realtime_end"])
            dates = release_dates(int(params["release_id"]), start, stop)
            return _Resp({"release_dates": [{"release_id": params["release_id"], "date": d} for d in dates]})
        return _Resp({}, status=404)

    return fake_get


class _FakeTicker:
    end: date = date(2026, 1, 1)

    def __init__(self, ticker: str):
        self.ticker = ticker

    def history(self, **kwargs):
        s = market_series(self.ticker, type(self).end)
        if s is None:
            return pd.DataFrame()
        return pd.DataFrame({"Close": s})


FIXTURE_FEEDS = [
    ("fixture://wire/markets", "Fixture wire", "Markets"),
    ("fixture://wire/economy", "Fixture econ", "Economy"),
]


def make_fake_parse(now: datetime):
    base = timegm(now.utctimetuple())

    def fake_parse(url, agent=None):
        entries = []
        for i, (title, cat) in enumerate(HEADLINES):
            if (cat == "Economy") != url.endswith("economy"):
                continue
            entries.append(SimpleNamespace(
                title=title,
                link=f"https://example.com/fixture/{i + 1}",
                published_parsed=gmtime(base - (i + 1) * 47 * 60),
            ))
        return SimpleNamespace(entries=entries, bozo=0)

    return fake_parse


@contextlib.contextmanager
def fake_upstreams(end: date, *, now: Optional[datetime] = None,
                   fred_key: Optional[str] = "fixture-key") -> Iterator[None]:
    """Swap every network seam for the deterministic fakes above."""
    now = now or datetime.combine(end, dtime(21, 0), tzinfo=timezone.utc)
    ticker_cls = type("FakeTicker", (_FakeTicker,), {"end": end})
    patches = [
        (market.yf, "Ticker", ticker_cls),
        (fred.requests, "get", make_fake_requests_get(end)),
        (news.feedparser, "parse", make_fake_parse(now)),
        (news, "FEEDS", FIXTURE_FEEDS),
        (fred.time, "sleep", lambda s: None),
        (market.time, "sleep", lambda s: None),
        (events.time, "sleep", lambda s: None),
    ]
    saved = [(obj, name, getattr(obj, name)) for obj, name, _ in patches]
    old_key = os.environ.get("FRED_API_KEY")
    try:
        for obj, name, val in patches:
            setattr(obj, name, val)
        if fred_key is None:
            os.environ.pop("FRED_API_KEY", None)
        else:
            os.environ["FRED_API_KEY"] = fred_key
        yield
    finally:
        for obj, name, val in saved:
            setattr(obj, name, val)
        if old_key is None:
            os.environ.pop("FRED_API_KEY", None)
        else:
            os.environ["FRED_API_KEY"] = old_key
