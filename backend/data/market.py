"""yfinance-backed market data: quotes, WoW/MoM/YTD changes, and history.

Design notes / reasonable choices made here:
  * We fetch ~5y of daily closes per ticker ONCE (cached ~60s) and derive
    everything — current value, WoW/MoM/YTD deltas, and every history range —
    from that single series. This keeps us well under yfinance rate limits.
  * "Trading days" approximations: WoW = 5 rows back, MoM = 21 rows back.
    YTD = last close of the prior calendar year. All are clamped to the
    nearest available prior observation, so weekends/holidays/gaps are safe.
  * Every fetch is wrapped: one bad ticker logs a warning and is omitted from
    the response rather than 500-ing the whole endpoint.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import pandas as pd
import yfinance as yf

from cache import cached

log = logging.getLogger("market")

# range -> number of calendar days to slice for the history endpoint
RANGE_DAYS = {
    "1W": 7,
    "1M": 31,
    "3M": 93,
    "6M": 186,
    "1Y": 366,
    "5Y": 5 * 366,
    # "YTD" handled specially
}


@dataclass(frozen=True)
class MarketSpec:
    id: str
    label: str
    category: str
    ticker: str
    unit: str = "$"
    # fallback yfinance ticker(s) tried in order if the primary returns nothing
    fallbacks: tuple[str, ...] = field(default_factory=tuple)
    # Optional sub-grouping inside a category. For Equities we tag the ETF
    # proxies vs the actual index levels so the UI can toggle between them.
    # None means "always show" (e.g. VIX).
    group: Optional[str] = None


# ---- The tracked market indicators (yfinance) -----------------------------
MARKET_SPECS: list[MarketSpec] = [
    # Equities — actual index levels (default view)
    # Order matches the conventional reading order (S&P -> Nasdaq -> Dow -> Russell)
    # and is mirrored exactly by the ETF group below so cards don't reshuffle on toggle.
    MarketSpec("GSPC", "S&P 500 (Index)", "Equities", "^GSPC", unit="pts", group="index"),
    MarketSpec("IXIC", "Nasdaq Composite", "Equities", "^IXIC", unit="pts", group="index"),
    MarketSpec("DJI", "Dow Jones (Index)", "Equities", "^DJI", unit="pts", group="index"),
    MarketSpec("RUT", "Russell 2000 (Index)", "Equities", "^RUT", unit="pts", group="index"),
    # Equities — ETF proxies (alternate view, toggle in UI)
    MarketSpec("SPY", "S&P 500 (SPY)", "Equities", "SPY", unit="$", group="etf"),
    MarketSpec("QQQ", "Nasdaq 100 (QQQ)", "Equities", "QQQ", unit="$", group="etf"),
    MarketSpec("DIA", "Dow Jones (DIA)", "Equities", "DIA", unit="$", group="etf"),
    MarketSpec("IWM", "Russell 2000 (IWM)", "Equities", "IWM", unit="$", group="etf"),
    # Always shown
    MarketSpec("VIX", "Volatility (VIX)", "Equities", "^VIX", unit="pts"),
    # Credit ETFs — proxy for HY / IG credit risk appetite
    MarketSpec("HYG", "High Yield (HYG)", "Credit", "HYG", unit="$"),
    MarketSpec("LQD", "Investment Grade (LQD)", "Credit", "LQD", unit="$"),
    # Global equity indices (non-US). Always shown — no group filter applies.
    MarketSpec("FTSE", "FTSE 100 (UK)", "Global Equities", "^FTSE", unit="pts"),
    MarketSpec("GDAXI", "DAX (Germany)", "Global Equities", "^GDAXI", unit="pts"),
    MarketSpec("STOXX50E", "Euro Stoxx 50", "Global Equities", "^STOXX50E", unit="pts"),
    MarketSpec("N225", "Nikkei 225 (Japan)", "Global Equities", "^N225", unit="pts"),
    MarketSpec("HSI", "Hang Seng (HK)", "Global Equities", "^HSI", unit="pts"),
    MarketSpec("SHCOMP", "Shanghai Composite", "Global Equities", "000001.SS", unit="pts"),
    # FX
    MarketSpec("DXY", "US Dollar Index (DXY)", "FX", "DX-Y.NYB", unit="pts"),
    MarketSpec("EURUSD", "EUR/USD", "FX", "EURUSD=X", unit=""),
    MarketSpec("USDJPY", "USD/JPY", "FX", "JPY=X", unit=""),
    MarketSpec("GBPUSD", "GBP/USD", "FX", "GBPUSD=X", unit=""),
    # Energy & metals
    MarketSpec("WTI", "WTI Crude (CL)", "Energy & Metals", "CL=F", unit="$"),
    MarketSpec("BRENT", "Brent Crude (BZ)", "Energy & Metals", "BZ=F", unit="$"),
    MarketSpec("NATGAS", "Nat Gas (NG)", "Energy & Metals", "NG=F", unit="$"),
    MarketSpec("GOLD", "Gold (GC)", "Energy & Metals", "GC=F", unit="$"),
    MarketSpec("SILVER", "Silver (SI)", "Energy & Metals", "SI=F", unit="$"),
    MarketSpec("COPPER", "Copper (HG)", "Energy & Metals", "HG=F", unit="$"),
    # Ags / softs
    MarketSpec("CORN", "Corn (ZC)", "Ags / Softs", "ZC=F", unit="¢"),
    MarketSpec("WHEAT", "Wheat (ZW)", "Ags / Softs", "ZW=F", unit="¢"),
    MarketSpec("SOY", "Soybeans (ZS)", "Ags / Softs", "ZS=F", unit="¢"),
    MarketSpec("SUGAR", "Sugar (SB)", "Ags / Softs", "SB=F", unit="¢"),
    MarketSpec("COFFEE", "Coffee (KC)", "Ags / Softs", "KC=F", unit="¢"),
    MarketSpec("COCOA", "Cocoa (CC)", "Ags / Softs", "CC=F", unit="$"),
    # Crypto
    MarketSpec("BTC", "Bitcoin (BTC)", "Crypto", "BTC-USD", unit="$"),
    MarketSpec("ETH", "Ethereum (ETH)", "Crypto", "ETH-USD", unit="$"),
]

MARKET_BY_ID = {s.id: s for s in MARKET_SPECS}


@cached("market", ttl=60)
def _download_series(ticker: str) -> Optional[pd.Series]:
    """Return a daily close Series (DatetimeIndex) for a ticker, or None.

    Cached ~60s per ticker. Any failure returns None (logged), never raises.
    """
    try:
        df = yf.Ticker(ticker).history(period="5y", interval="1d", auto_adjust=False)
        if df is None or df.empty or "Close" not in df:
            log.warning("yfinance returned no data for %s", ticker)
            return None
        s = df["Close"].dropna()
        if s.empty:
            return None
        # normalize index to tz-naive dates for clean slicing/serialization
        s.index = pd.to_datetime(s.index).tz_localize(None)
        return s
    except Exception as exc:  # noqa: BLE001 - we never want one ticker to crash a route
        log.warning("yfinance fetch failed for %s: %s", ticker, exc)
        return None


def _resolve_series(spec: MarketSpec) -> tuple[Optional[pd.Series], str]:
    """Try the primary ticker then any fallbacks. Returns (series, used_ticker)."""
    for tk in (spec.ticker, *spec.fallbacks):
        s = _download_series(tk)
        if s is not None and not s.empty:
            return s, tk
    return None, spec.ticker


def _value_n_rows_back(s: pd.Series, n: int) -> Optional[float]:
    if len(s) > n:
        return float(s.iloc[-(n + 1)])
    return None


def _prior_year_close(s: pd.Series) -> Optional[float]:
    """Last close of the prior calendar year (nearest prior observation)."""
    if s.empty:
        return None
    current_year = s.index[-1].year
    prior = s[s.index.year < current_year]
    if prior.empty:
        return None
    return float(prior.iloc[-1])


def _pct(curr: float, base: Optional[float]) -> Optional[dict]:
    if base is None or base == 0:
        return None
    return {"abs": round(curr - base, 4), "pct": round((curr - base) / base * 100, 2)}


SPARKLINE_DAILY_POINTS = 30  # ~6 trading weeks for daily series


def build_market_indicator(spec: MarketSpec) -> Optional[dict]:
    """Build one indicator dict for the /api/indicators response, or None."""
    s, used = _resolve_series(spec)
    if s is None or s.empty:
        return None
    curr = float(s.iloc[-1])
    as_of = s.index[-1].date().isoformat()

    change = {
        "wow": _pct(curr, _value_n_rows_back(s, 5)),
        "mom": _pct(curr, _value_n_rows_back(s, 21)),
        "ytd": _pct(curr, _prior_year_close(s)),
    }
    spark = [round(float(v), 4) for v in s.iloc[-SPARKLINE_DAILY_POINTS:].tolist()]
    return {
        "id": spec.id,
        "label": spec.label,
        "category": spec.category,
        "group": spec.group,
        "value": round(curr, 4),
        "unit": spec.unit,
        "asOf": as_of,
        "changeType": "pct",
        "source": f"yfinance:{used}",
        "change": change,
        "sparkline": spark,
    }


def get_market_indicators() -> list[dict]:
    out: list[dict] = []
    for spec in MARKET_SPECS:
        try:
            ind = build_market_indicator(spec)
            if ind is not None:
                out.append(ind)
            else:
                log.warning("skipping market indicator %s (no data)", spec.id)
        except Exception as exc:  # noqa: BLE001
            log.warning("failed building market indicator %s: %s", spec.id, exc)
    return out


def get_market_history(spec_id: str, range_: str) -> Optional[list[dict]]:
    """Return [{date, value}] for a market indicator + range, or None if unknown id."""
    spec = MARKET_BY_ID.get(spec_id)
    if spec is None:
        return None
    s, _ = _resolve_series(spec)
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
        {"date": idx.date().isoformat(), "value": round(float(val), 4)}
        for idx, val in sliced.items()
    ]
