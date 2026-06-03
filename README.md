# Macro Desk — Global Macro Dashboard

A local, single-machine full-stack app for watching global macro markets. Two jobs:

1. **Markets dashboard** — the key numbers you watch (equities, rates, FX, energy,
   metals, ags/softs, economic data, crypto) with current value + **WoW / MoM / YTD**
   change and **click-through historical charts**. Equities can be viewed as either
   actual index levels (^GSPC / ^IXIC / ^DJI / ^RUT, default) or ETF proxies
   (SPY / QQQ / DIA / IWM) — preference is persisted.
2. **News + economic calendar** — an aggregated RSS news rail filterable by world
   topic (Fed, Markets, Economy, Energy, China, Geopolitics, etc.), an upcoming
   FRED economic-release calendar, and **per-indicator related news** surfaced
   when you click a card.

Dark, dense, terminal-style UI. Monospace numbers, green/red deltas, muted chrome.

---

## Stack

| Layer     | Tech |
|-----------|------|
| Backend   | Python 3.11+ · FastAPI · uvicorn · `yfinance` (prices) · FRED REST (econ series) · `feedparser` (news) |
| Frontend  | Vite · React · TypeScript · Tailwind CSS · Recharts · TanStack Query |
| Caching   | In-memory TTL cache (`cachetools`): market ~60s, FRED ~6h, news ~10min, calendar ~6h |
| Config    | `.env` for `FRED_API_KEY` (optional — app runs without it) |

No database, no auth, no deployment config — clean single-shot local app.

---

## Quick start

### Prerequisites
- Python **3.11+** (tested on 3.14)
- Node **18+** (tested on 24) + npm

### One-time setup
```bash
make setup
```
This creates `backend/venv`, installs backend deps, copies `backend/.env.example`
→ `backend/.env`, and runs `npm install` in `frontend/`.

> No `make`? Do it manually:
> ```bash
> # backend
> cd backend && python3 -m venv venv && source venv/bin/activate
> pip install -r requirements.txt && cp .env.example .env && cd ..
> # frontend
> cd frontend && npm install && cd ..
> ```

### Run both sides
```bash
make dev
```
- Backend (FastAPI)  → http://127.0.0.1:8000  (docs at `/docs`)
- Frontend (Vite)    → http://localhost:5173  ← **open this**

The frontend proxies `/api/*` to the backend, so you only ever browse `:5173`.

**Run each side on its own** (two terminals):
```bash
make backend     # uvicorn on :8000
make frontend    # vite on :5173
```

Prefer npm? A root `npm run dev` is also wired up (uses `concurrently`):
```bash
npm install      # installs concurrently at the repo root
npm run dev
```

---

## FRED API key (optional but recommended)

The app **runs without a key** — you still get equities, FX, energy, metals,
ags/softs, crypto, and news. But the **Rates**, **Economic Data**, and
**Economic Calendar** panels come from FRED, so without a key they are hidden and
a banner reminds you to add one.

To enable them:

1. Create a free FRED account: https://fred.stlouisfed.org/
2. Request an API key: **My Account → API Keys → Request API Key**
   (direct link: https://fred.stlouisfed.org/docs/api/api_key.html)
3. Put it in `backend/.env`:
   ```
   FRED_API_KEY=your_key_here
   ```
4. Restart the backend (`make backend` or `make dev`). The Rates / Economic Data /
   Calendar panels light up automatically.

---

## API

Base URL: `http://127.0.0.1:8000`

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | liveness check |
| GET | `/api/meta` | `{ fredEnabled, categories, lastRefreshed }` |
| GET | `/api/indicators` | all tracked indicators with value + WoW/MoM/YTD change |
| GET | `/api/indicators/{id}/history?range=1W\|1M\|3M\|6M\|YTD\|1Y\|5Y` | time series `[{date, value}]` |
| GET | `/api/news` | deduped, reverse-chron news `[{title, source, url, publishedAt, category, topics}]` — `topics` is a list of world-topic tags (Fed, Markets, Economy, Energy, Tech, China, Geopolitics, Crypto, Earnings) auto-classified from each headline |
| GET | `/api/calendar` | next ~14 days of upcoming FRED releases — Employment Situation (NFP), CPI, PPI, Retail Sales, PCE, GDP, weekly Initial Jobless Claims (empty/disabled without a key) |
| POST | `/api/refresh` | clear all caches (the header **↻ refresh** button) |

**Indicator shape:**
```jsonc
{
  "id": "SPY",
  "label": "S&P 500 (SPY)",
  "category": "Equities",
  "group": "etf",               // "etf" | "index" for Equities; null elsewhere
  "value": 759.57,
  "unit": "$",
  "asOf": "2026-06-02",
  "changeType": "pct",          // "pct" for prices, "bps" for yields
  "source": "yfinance:SPY",
  "change": {
    "wow": { "abs": 8.98, "pct": 1.2 },   // ~5 trading days
    "mom": { "abs": 35.0, "pct": 5.4 },   // ~21 trading days
    "ytd": { "abs": 77.65, "pct": 11.39 } // vs last close of prior year
  }
}
```
For **yields** (`changeType: "bps"`), `change.*.abs` is the move in **basis points**
and `pct` is `null`. For **monthly FRED releases** (CPI, PCE, payrolls, …) the `wow`
slot carries **change vs the prior print** and `ytd` carries **YoY** (the card labels
these "vs prior" and "YoY"); `meta.priorPrint` holds the previous level.

---

## What's tracked

| Category | Source | Instruments |
|----------|--------|-------------|
| **Equities** | yfinance | **Indices (default):** ^GSPC, ^IXIC, ^DJI, ^RUT, ^VIX · **ETFs (toggle):** SPY, QQQ, DIA, IWM · VIX always shows |
| **Rates** | FRED | DGS2, DGS10, DGS30, T10Y2Y (2s10s), DFF (fed funds), ICSA (initial claims) |
| **FX** | yfinance (FRED fallback) | DXY (`DX-Y.NYB`, falls back to FRED `DTWEXBGS`), EURUSD, USDJPY, GBPUSD |
| **Energy & Metals** | yfinance | WTI (CL=F), Brent (BZ=F), NatGas (NG=F), Gold (GC=F), Silver (SI=F), Copper (HG=F) |
| **Ags / Softs** | yfinance | Corn (ZC=F), Wheat (ZW=F), Soybeans (ZS=F), Sugar (SB=F), Coffee (KC=F), Cocoa (CC=F) |
| **Economic Data** | FRED | CPI, Core CPI, PCE, Core PCE, Payrolls, Unemployment, Real GDP, Retail Sales, PPI |
| **Crypto** | yfinance | BTC-USD, ETH-USD |

### Change math
- **WoW** = vs ~5 trading days ago · **MoM** = vs ~21 trading days ago ·
  **YTD** = vs last close of the prior calendar year.
- For FRED monthly/quarterly releases, WoW = vs prior print, YTD = YoY.
- Yields are expressed in **basis points**; prices/levels in **%**.
- All lookbacks snap to the **nearest available prior observation**, so weekends,
  holidays, and gaps are handled.

### News feeds
Edit the `FEEDS` list at the top of [`backend/data/news.py`](backend/data/news.py)
to add/remove sources. Each item is tagged with a `category` from its source
**and** an auto-classified `topics: string[]` derived from the headline.
Shipped feeds (all verified working as of build):

- CNBC top news · CNBC economy · MarketWatch top stories ·
  Federal Reserve press releases · Yahoo Finance headlines

Dead/404 feeds are skipped with a logged warning — a broken feed never breaks the page.

**World-topic classification** is driven by the `TOPIC_KEYWORDS` map at the
top of `news.py` — edit it to tune what falls under Fed / Markets / Economy /
Energy / Tech / Crypto / China / Geopolitics / Earnings. The news rail uses
these tags as its filter tabs.

### Calendar
The economic calendar pulls upcoming dates for the major US macro releases
via FRED's `/fred/release/dates` endpoint — one request per release, throttled
to stay under FRED's 120 req/min cap, cached ~6h. Releases included:
Employment Situation (NFP / Unemployment), CPI, PPI, Advance Retail Sales,
Personal Income & Outlays (PCE), GDP, and weekly Initial Jobless Claims.

### Per-indicator news
Click any indicator card to open the chart modal. It has a **Chart** tab and a
**News** tab; the News tab filters the global feed down to articles whose
headline matches that indicator's keywords (e.g. clicking **CPI** surfaces
inflation articles, clicking **WTI** surfaces oil articles). The keyword
map lives in [`frontend/src/indicator-keywords.ts`](frontend/src/indicator-keywords.ts).

---

## Design choices & notes

- **Single fetch per ticker.** Each yfinance ticker is pulled once (5y daily,
  cached ~60s) and every value/delta/chart range is derived from that one series —
  keeps us well under upstream rate limits.
- **Graceful degradation everywhere.** A single failing ticker, feed, or FRED
  series is logged and omitted; it never 500s an endpoint or blanks the page.
  Missing FRED key → those panels hide + a banner shows.
- **DXY fallback.** If yfinance `DX-Y.NYB` returns nothing, the backend falls back
  to the FRED broad dollar index (`DTWEXBGS`) when a key is present.
- **Equity view toggle.** The Equities section header has an Indices / ETFs
  toggle (default: Indices). Choice persists in `localStorage` under
  `macro:equityView`. Card order is identical in both views (S&P → Nasdaq →
  Dow → Russell → VIX) so cards don't reshuffle on flip.
- **Auto-refresh.** The frontend re-pulls `/api/indicators` every 60s via TanStack
  Query; the header shows last-updated and has a manual **↻ refresh** (which also
  clears backend caches).
- **Responsive.** Works on a phone — the news rail drops below the grid, cards
  reflow, and the chart modal is full-width on small screens.
- **Type alignment.** Backend response shapes are mirrored in
  [`frontend/src/types.ts`](frontend/src/types.ts).

---

## Project layout
```
backend/
  main.py            FastAPI app + routes
  data/
    market.py        yfinance fetchers + WoW/MoM/YTD calc
    fred.py          FRED series, releases, and release calendar
    news.py          RSS aggregation (edit FEEDS here)
  cache.py           TTL cache helper
  requirements.txt
  .env.example
frontend/            Vite + React + TS + Tailwind + Recharts
  src/
    components/      IndicatorCard, ChartModal (tabbed Chart/News),
                     NewsFeed (with topic tabs), CalendarPanel
    indicator-keywords.ts   indicator -> news-search keywords map
    topics.ts        world-topic display order
    types.ts         response shapes (mirrors backend)
Makefile             make setup / dev / backend / frontend
package.json         optional root `npm run dev` (concurrently)
README.md
```

---

## Troubleshooting

- **Frontend loads but cards say "failed to load indicators".** The backend isn't
  running on `:8000`. Start it with `make backend`.
- **Rates / Economic Data / Calendar missing.** No FRED key — see the section above.
- **A single instrument is missing.** yfinance occasionally rate-limits or a futures
  symbol returns nothing transiently; it'll reappear on the next 60s refresh. Check
  the backend log for a `WARNING`.
- **Port already in use.** Override the backend with `HOST=… PORT=… make backend`,
  or change the Vite port in `frontend/vite.config.ts` (also update the proxy/CORS).
