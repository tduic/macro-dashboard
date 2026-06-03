"""FastAPI app for the global macro dashboard.

Routes:
  GET /api/health
  GET /api/meta                       -> {fredEnabled, categories, lastRefreshed}
  GET /api/indicators                 -> all tracked indicators
  GET /api/indicators/{id}/history    -> ?range=1W|1M|3M|6M|YTD|1Y|5Y
  GET /api/news
  GET /api/calendar
  POST /api/refresh                   -> clear caches (manual refresh button)

Every route is resilient: a single failing upstream ticker/feed/series is
logged and skipped rather than failing the whole response.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

# load .env before importing data modules that read FRED_API_KEY
load_dotenv()

import cache  # noqa: E402
from data import events as events_data  # noqa: E402
from data import fred, market, news  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("main")

app = FastAPI(title="Global Macro Dashboard API", version="1.0.0")

# Vite dev server runs on 5173 by default; allow local origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

VALID_RANGES = {"1W", "1M", "3M", "6M", "YTD", "1Y", "5Y"}

# Category display order for the frontend grid.
CATEGORY_ORDER = [
    "Equities", "Global Equities", "Rates", "FX", "Energy & Metals",
    "Ags / Softs", "Economic Data", "Crypto",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "time": _now_iso()}


@app.get("/api/meta")
def meta() -> dict:
    return {
        "fredEnabled": fred.has_fred_key(),
        "categories": CATEGORY_ORDER,
        "lastRefreshed": _now_iso(),
    }


@app.get("/api/indicators")
def indicators() -> dict:
    items = market.get_market_indicators()

    # DXY fallback: if yfinance DX-Y.NYB produced no card, try FRED broad dollar.
    if not any(i["id"] == "DXY" for i in items):
        fb = fred.get_broad_dollar_fallback()
        if fb:
            items.append(fb)
            log.info("used FRED DTWEXBGS fallback for DXY")

    items.extend(fred.get_fred_indicators())

    # stable ordering by category then original spec order
    order = {c: n for n, c in enumerate(CATEGORY_ORDER)}
    items.sort(key=lambda i: order.get(i["category"], 99))

    return {
        "asOf": _now_iso(),
        "fredEnabled": fred.has_fred_key(),
        "count": len(items),
        "indicators": items,
    }


@app.get("/api/indicators/{indicator_id}/history")
def history(indicator_id: str, range: str = Query("1Y")) -> dict:  # noqa: A002
    rng = range.upper()
    if rng not in VALID_RANGES:
        raise HTTPException(status_code=400, detail=f"invalid range; use one of {sorted(VALID_RANGES)}")

    series = market.get_market_history(indicator_id, rng)
    if series is None:
        series = fred.get_fred_history(indicator_id, rng)
    if series is None:
        raise HTTPException(status_code=404, detail=f"unknown indicator '{indicator_id}'")

    return {"id": indicator_id, "range": rng, "points": series}


@app.get("/api/news")
def news_endpoint() -> dict:
    items = news.get_news()
    return {"asOf": _now_iso(), "count": len(items), "items": items}


@app.get("/api/calendar")
def calendar() -> dict:
    if not fred.has_fred_key():
        return {"enabled": False, "items": []}
    items = fred.get_calendar(days_ahead=14)
    return {"enabled": True, "count": len(items), "items": items}


@app.get("/api/events")
def events(
    from_: str = Query(..., alias="from", description="YYYY-MM-DD"),
    to: str = Query(..., description="YYYY-MM-DD"),
) -> dict:
    items = events_data.get_events(from_, to)
    return {"from": from_, "to": to, "count": len(items), "events": items}


@app.post("/api/refresh")
def refresh() -> dict:
    cache.clear_all()
    return {"status": "cleared", "time": _now_iso()}


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host=host, port=port, reload=True)
