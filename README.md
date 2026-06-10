# Macro Desk — Global Macro Dashboard

A local, single-machine full-stack app for watching global macro markets. Two jobs:

1. **Markets dashboard** — the key numbers you watch (equities, rates, FX, energy,
   metals, ags/softs, economic data, crypto) with current value + **WoW / MoM / YTD**
   change, **inline sparklines** so each card shows shape not just a number, and
   **click-through historical charts**. Equities can be viewed as either actual
   index levels (^GSPC / ^IXIC / ^DJI / ^RUT, default) or ETF proxies (SPY / QQQ
   / DIA / IWM) — preference is persisted.
2. **News + economic calendar** — an aggregated RSS news rail filterable by world
   topic (Fed, Markets, Economy, Energy, China, Geopolitics, etc.), an upcoming
   FRED economic-release calendar, and **per-indicator related news** surfaced
   when you click a card.

**Synoptic reads:**
- A **"Today" mover strip** at the very top shows the three biggest 1-day movers
  with their driver headlines (clickable to the article).
- A **macro regime strip** under it distills the dashboard into a 1-line read
  ("Risk-On · Yields down · Dollar offered · Crude bid …") with a net-bias label.
- A **Grid / Heatmap** toggle in the header swaps the category grid for a single
  sorted, color-graded view (1W / MoM / YTD selector) so you can absorb relative
  cross-asset performance in one glance.
- Every card carries an **inline sparkline**, a **1Y / 2Y percentile gauge** with
  a hot/cold tick (95 = at year-high, 5 = at year-low), an **anomaly flag** ⚠
  when the latest move is > ±2σ vs the trailing 30-day distribution, a
  **stale-data badge** if the data hasn't refreshed within the expected cadence,
  and a **drawdown read** ("▼7.3% off 1Y hi", red-tinted when >5% off) showing
  how far the price sits below its trailing-1Y running max — hidden when at/near
  the high, and omitted for yields and monthly releases where it's meaningless.
- A **UST yield-curve panel** below the Rates row plots the full 11-tenor curve
  (1M → 30Y) with toggleable historical overlays (1W ago / 1M ago / 3M ago /
  prior year-end) so you can read the *shape* and how it has shifted.
- **Chart modal overlays** mark FOMC rate decisions (gold) and major release
  dates (CPI / PCE / PPI / NFP / Retail / GDP, color-coded) on every historical
  chart, turning a price line into a narrative.
- **Compare / overlay** — pick any other indicator from a dropdown inside the
  chart modal to plot it on a second axis. Reveals real cross-asset
  relationships (SPY ↔ VIX, 10Y ↔ Gold, DXY ↔ EURUSD, etc.).

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

**Run the tests** (both suites, fully offline — every network seam is mocked):
```bash
make test        # backend pytest (93 tests) + frontend vitest (70 tests)
```
- `backend/tests/` (pytest, 93): change math (WoW/MoM/YTD, nearest-prior
  snapping, bps for yields), drawdown, ratio derivation, percentile ranking,
  news topic classification / dedupe / dead-feed resilience, FOMC + FRED
  event merging, UST curve snapshot construction, the release calendar
  window logic, and TestClient contract tests for every API route.
- `frontend/tests/` (vitest, 70): the pure-logic modules — regime strip
  derivation, the ±2σ anomaly detector, staleness windows, top-mover /
  driver-headline synthesis, heatmap palette, indicator keyword & event
  mappings, and formatting helpers.

Run either side alone:
```bash
cd backend && ./venv/bin/python -m pytest -q tests
cd frontend && npm run test
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
| GET | `/api/events?from=YYYY-MM-DD&to=YYYY-MM-DD` | macro-event dates in a window for chart overlays: hardcoded FOMC rate-decision dates + past/future FRED release dates (NFP, CPI, PPI, Retail, PCE, GDP) |
| GET | `/api/curves/ust` | UST yield curve snapshot — current curve + comparison snapshots (1W ago, 1M ago, 3M ago, prior year-end). Empty without a FRED key. |
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
  },
  "sparkline": [ /* last ~30 daily closes, or ~12 monthly prints for releases */ ],
  "percentile": { "value": 78.2, "window": "1Y" }, // where current sits in trailing window
  "drawdown": { "pct": -7.3, "peakDate": "2026-02-14" } // vs trailing-1Y running max
}
```
`drawdown` is `value / max(trailing 1Y closes) - 1` in % (`0` = at the 1Y high;
`peakDate` is when the high was set), derived from the already-fetched series.
Present only for price-type indicators (`changeType: "pct"` market/ratio cards);
`null`/absent for yields (bps) and monthly FRED releases where it's meaningless.
For **yields** (`changeType: "bps"`), `change.*.abs` is the move in **basis points**
and `pct` is `null`. For **monthly FRED releases** (CPI, PCE, payrolls, …) the `wow`
slot carries **change vs the prior print** and `ytd` carries **YoY** (the card labels
these "vs prior" and "YoY"); `meta.priorPrint` holds the previous level.

---

## What's tracked

| Category | Source | Instruments |
|----------|--------|-------------|
| **Equities** | yfinance | **Indices (default):** ^GSPC, ^IXIC, ^DJI, ^RUT, ^VIX · **ETFs (toggle):** SPY, QQQ, DIA, IWM · VIX always shows |
| **Global Equities** | yfinance | FTSE 100 (^FTSE), DAX (^GDAXI), Euro Stoxx 50 (^STOXX50E), Nikkei 225 (^N225), Hang Seng (^HSI), Shanghai Composite (000001.SS) |
| **Rates** | FRED | DGS2, DGS10, DGS30, T10Y2Y (2s10s), T5YIE (5Y breakeven), T10YIE (10Y breakeven), T5YIFR (5y5y forward), DFII10 (10Y real yield / TIPS), DFF (fed funds), ECBDFR (ECB deposit rate), IUDSOIA (BoE / SONIA), IR3TIB01JPM156N (BoJ 3M interbank), ICSA (initial claims) — plus the **UST yield-curve panel** spanning DGS1MO → DGS30 |
| **Credit** | yfinance | HYG (high-yield ETF), LQD (investment-grade ETF) — proxies for credit-risk appetite |
| **FX** | yfinance (FRED fallback) | DXY (`DX-Y.NYB`, falls back to FRED `DTWEXBGS`), EURUSD, USDJPY, GBPUSD |
| **Energy & Metals** | yfinance | WTI (CL=F), Brent (BZ=F), NatGas (NG=F), Gold (GC=F), Silver (SI=F), Copper (HG=F) |
| **Ags / Softs** | yfinance | Corn (ZC=F), Wheat (ZW=F), Soybeans (ZS=F), Sugar (SB=F), Coffee (KC=F), Cocoa (CC=F) |
| **Economic Data** | FRED | CPI, Core CPI, PCE, Core PCE, Payrolls, Unemployment, Real GDP, Retail Sales, PPI |
| **Crypto** | yfinance | BTC-USD, ETH-USD |
| **Ratios** | derived | Gold/Silver, Copper/Gold (growth), BTC/Gold (digital-vs-real), ETH/BTC (crypto risk appetite) |

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
**Related News** tab; the News tab filters the global feed down to articles
whose headline matches that indicator's keywords (e.g. clicking **CPI**
surfaces inflation articles, clicking **WTI** surfaces oil articles). The
keyword map lives in [`frontend/src/indicator-keywords.ts`](frontend/src/indicator-keywords.ts).

The Related News view is **release-anchored** where applicable. For CPI /
PCE / NFP / PPI / Retail Sales / GDP and the Fed Funds rate, a strip at
the top shows the previous and next release/FOMC date (e.g. "last
2026-05-13 (21d ago) · next 2026-06-10 (in 7d)") so you can read each
headline against the calendar. Below the strip, items are grouped into
**Today / Past 7 days / Older** buckets with sticky section headers,
making it easy to see what's pre-print vs post-print at a glance.

The indicator → event-type map lives in
[`frontend/src/indicator-events.ts`](frontend/src/indicator-events.ts).

---

## Responsive design — desktop vs iPhone

The same React app renders two distinct experiences depending on viewport.

**Desktop / `≥1024px`** — terminal-style dense board:
- Wide multi-column grid (up to 5 cards wide on `xl`).
- Sticky news rail on the right (always visible while you scroll).
- Chart opens as a centered floating modal you can click-outside to close.
- Hover states everywhere; muted chrome only emerges on intent.

**Mobile / iPad portrait / iPhone (`<1024px`)** — native-feeling iOS shell:
- Header collapses to title + view-toggle + a circular ↻ icon.
- Single-column card stack with comfortable 44pt tap targets.
- A **fixed bottom tab bar** swaps between **Markets** and **News** views
  (`▦ Markets` · `📰 News` with a live count badge).
- The chart opens as a **bottom sheet** that slides up from below with a
  drag-handle pill — feels native, not modal.
- Full **safe-area inset** support (Dynamic Island / home-bar respected via
  `viewport-fit=cover` + `env(safe-area-inset-*)`).
- PWA manifest + apple-touch icon + status-bar style — **Share → Add to
  Home Screen** gives you a real launcher icon and standalone launch with
  no Safari chrome. Theme color matches the app background, so the iOS
  status bar blends in.
- System font stack — uses SF Pro on iOS / macOS for that native look.
- No tap-highlight blue, no rubber-band over-scroll, `prefers-reduced-motion`
  honored.

The breakpoint is `(max-width: 1023px)`; iPad landscape gets the desktop
layout, iPad portrait + all phones get the mobile shell.

## Design choices & notes

- **Single fetch per ticker.** Each yfinance ticker is pulled once (5y daily,
  cached ~60s) and every value/delta/chart range is derived from that one series —
  keeps us well under upstream rate limits.
- **Graceful degradation everywhere.** A single failing ticker, feed, or FRED
  series is logged and omitted; it never 500s an endpoint or blanks the page.
  yfinance fetches get one cheap retry (~0.5s backoff) so a transient blip
  doesn't drop a card for a whole cache cycle. Missing FRED key → those panels
  hide + a banner shows.
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
  tests/             offline pytest suite: math, news, events, curves, calendar, API routes
  requirements.txt
  .env.example
frontend/            Vite + React + TS + Tailwind + Recharts
  public/
    manifest.webmanifest    PWA manifest (Add to Home Screen)
    apple-touch-icon.svg    iOS launcher icon
    favicon.svg
  src/
    components/      IndicatorCard, Sparkline, PercentileBar, ChartModal
                     (tabbed Chart/News, bottom sheet on mobile),
                     NewsFeed (with topic tabs), CalendarPanel, RegimeStrip,
                     DailySummary, HeatmapGrid, YieldCurvePanel
    indicator-keywords.ts   indicator -> news-search keywords
    indicator-events.ts     indicator -> release event-type map
    daily-summary.ts         top-movers + driver-headline synthesizer
    anomaly.ts               ±2σ z-score detector for the ⚠ flag
    staleness.ts             freshness classifier for the "Xd old" badge
    regime.ts                regime-strip read derivation
    heatmap-color.ts         heatmap palette
    topics.ts                world-topic display order
    useMediaQuery.ts         compact-viewport hook (iPhone vs desktop)
    types.ts                 response shapes (mirrors backend)
  tests/             offline vitest suite for the pure-logic modules above
  vitest.config.ts   test-runner config (kept separate from vite.config.ts)
Makefile             make setup / dev / backend / frontend / test (runs both suites)
package.json         optional root `npm run dev` (concurrently)
README.md
```

---

## Remote access from other devices (Tailscale)

The dev server is configured to listen on **all network interfaces** (Vite
`server.host: true`), and `server.allowedHosts` permits any `*.ts.net` host
so it plays nice with `tailscale serve`. The FastAPI backend stays bound
to `127.0.0.1` — only Vite is reachable across interfaces, and it proxies
`/api/*` to the local backend.

[Tailscale](https://tailscale.com) is the cleanest private path: install
on this machine and any other devices (iPhone, second laptop, …), sign in
with the same account, then pick one of the URL flavors below. Works
anywhere both devices have internet; nothing is publicly exposed.

### URL options (cleanest → simplest)

The Tailscale FQDN format is `<machine>.<tailnet-id>.ts.net`. Substitute
your own values from `tailscale status --json | jq '.Self.DNSName'`.

**1. HTTPS with no port (Tailscale Serve)** — `https://<machine>.<tailnet>.ts.net/`

The slickest option. Tailscale fronts the dashboard with a valid
Let's Encrypt cert on port 443.

```bash
# on the host (one-time)
tailscale serve --bg 5173

# then on any device on your tailnet
open https://<machine>.<tailnet>.ts.net/

# to remove later
tailscale serve --https=443 off
```

`serve` config persists across reboots. Keep `make dev` running.

**2. MagicDNS hostname with port** — `http://<machine>:5173/`

If MagicDNS is enabled (it is by default on new tailnets) you can use the
short machine name directly:

```
http://macbook-pro:5173/
```

**3. Raw Tailscale IP** — `http://100.x.y.z:5173/`

Always works regardless of MagicDNS:

```bash
tailscale ip -4
# -> e.g. 100.107.138.119
open http://100.107.138.119:5173/
```

**Cleaner machine name**: rename in the Tailscale admin console
([login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines))
— e.g. rename `macbook-pro` to `macro` and you get
`https://macro.<tailnet>.ts.net/`.

### Keep the host awake
The host must be awake for the dashboard to respond. On a MacBook with the
lid closed, either keep it plugged in with `caffeinate -dimsu &` running,
or graduate to a real deployment.

### LAN-only fallback
For LAN access without Tailscale, substitute the host's Wi-Fi IP
(`ipconfig getifaddr en0`) — works when both devices share a Wi-Fi.

---

## Roadmap

Things deliberately deferred but tracked for later.

- **Proper deploy.** Today the app runs on the host machine and is reachable
  remotely via Tailscale Serve (`https://<machine>.<tailnet>.ts.net/`). To be
  truly always-on without the host being awake, split the deploy:
  - **Frontend** → Vercel (Vite static build, free tier).
  - **Backend** → Fly.io or Railway (single Python container, the existing
    cachetools TTL cache survives because it's a long-running process).
  - Optional custom domain (`macro.<your>.com`) + Cloudflare Access or a
    Bearer token check at the API boundary since the URL becomes public.
- ~~Drawdown / running-max indicators on each card.~~ ✅ **Done** — price cards
  now show "▼x% off 1Y hi" vs the trailing-1Y running max (see indicator shape).
- Bond MOVE / curve volatility surfaces (no clean free source today).
- Estimates vs actuals on the calendar (would need a paid feed).

## Troubleshooting

- **Frontend loads but cards say "failed to load indicators".** The backend isn't
  running on `:8000`. Start it with `make backend`.
- **Rates / Economic Data / Calendar missing.** No FRED key — see the section above.
- **A single instrument is missing.** yfinance occasionally rate-limits or a futures
  symbol returns nothing transiently; it'll reappear on the next 60s refresh. Check
  the backend log for a `WARNING`.
- **Port already in use.** Override the backend with `HOST=… PORT=… make backend`,
  or change the Vite port in `frontend/vite.config.ts` (also update the proxy/CORS).
