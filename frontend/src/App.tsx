import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { EquityView, Indicator } from "./types";
import { formatClock } from "./format";
import { IndicatorCard } from "./components/IndicatorCard";
import { ChartModal } from "./components/ChartModal";
import { NewsFeed } from "./components/NewsFeed";
import { CalendarPanel } from "./components/CalendarPanel";

const CATEGORY_ORDER = [
  "Equities",
  "Rates",
  "FX",
  "Energy & Metals",
  "Ags / Softs",
  "Economic Data",
  "Crypto",
];

function EquityViewToggle({
  value,
  onChange,
}: {
  value: EquityView;
  onChange: (v: EquityView) => void;
}) {
  const opts: { id: EquityView; label: string; hint: string }[] = [
    { id: "index", label: "Indices", hint: "^GSPC · ^IXIC · ^DJI · ^RUT" },
    { id: "etf", label: "ETFs", hint: "SPY · QQQ · DIA · IWM" },
  ];
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded border border-chrome-border bg-chrome-card p-0.5"
      role="tablist"
      aria-label="Equity view"
    >
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          title={o.hint}
          aria-selected={o.id === value}
          role="tab"
          className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors ${
            o.id === value
              ? "bg-chrome-text text-chrome-bg"
              : "text-chrome-muted hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FredBanner() {
  return (
    <div className="rounded border border-yellow-600/40 bg-yellow-900/20 px-3 py-2 text-xs text-yellow-200">
      <span className="font-semibold">FRED key not set.</span> Rates, Economic Data, and the
      Economic Calendar are disabled. Add a free key to{" "}
      <code className="rounded bg-black/40 px-1">backend/.env</code> as{" "}
      <code className="rounded bg-black/40 px-1">FRED_API_KEY=…</code> and restart the backend. See
      the README for how to get one.
    </div>
  );
}

const EQUITY_VIEW_STORAGE = "macro:equityView";

export default function App() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Indicator | null>(null);

  // Equities toggle: actual index levels (^GSPC/^IXIC/^DJI/^RUT) vs ETF
  // proxies (SPY/QQQ/DIA/IWM). Persisted in localStorage; default = index.
  const [equityView, setEquityView] = useState<EquityView>(() => {
    if (typeof window === "undefined") return "index";
    const v = window.localStorage.getItem(EQUITY_VIEW_STORAGE);
    return v === "etf" ? "etf" : "index";
  });
  useEffect(() => {
    window.localStorage.setItem(EQUITY_VIEW_STORAGE, equityView);
  }, [equityView]);

  const { data, isLoading, isError, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ["indicators"],
    queryFn: api.indicators,
    refetchInterval: 60_000, // auto-refresh market data every 60s
    staleTime: 30_000,
  });

  const indicators = data?.indicators ?? [];
  const fredEnabled = data?.fredEnabled ?? false;

  const grouped = useMemo(() => {
    const map = new Map<string, Indicator[]>();
    for (const ind of indicators) {
      // Equities filter: keep cards whose group matches the toggle, plus any
      // un-grouped equities (VIX) which always show.
      if (ind.category === "Equities" && ind.group && ind.group !== equityView) {
        continue;
      }
      if (!map.has(ind.category)) map.set(ind.category, []);
      map.get(ind.category)!.push(ind);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      items: map.get(c)!,
    }));
  }, [indicators, equityView]);

  async function handleRefresh() {
    await api.refresh();
    await qc.invalidateQueries();
  }

  return (
    <div className="min-h-screen bg-chrome-bg text-chrome-text">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-chrome-border bg-chrome-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-sm font-bold tracking-tight text-white">
              MACRO<span className="text-up">·</span>DESK
            </span>
            <span className="hidden font-mono text-[11px] text-chrome-muted sm:inline">
              global macro tracker
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-chrome-muted">
              {isFetching
                ? "refreshing…"
                : `updated ${formatClock(new Date(dataUpdatedAt).toISOString())}`}
            </span>
            <button
              onClick={handleRefresh}
              className="rounded border border-chrome-border px-2.5 py-1 font-mono text-xs text-chrome-text hover:border-chrome-muted hover:text-white"
            >
              ↻ refresh
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-4">
        {!isLoading && !fredEnabled && (
          <div className="mb-4">
            <FredBanner />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
          {/* Left / main column: indicators + calendar */}
          <div className="flex flex-col gap-5">
            {isLoading ? (
              <div className="py-20 text-center text-sm text-chrome-muted">loading markets…</div>
            ) : isError ? (
              <div className="py-20 text-center text-sm text-down">
                failed to load indicators — is the backend running on :8000?
              </div>
            ) : (
              <>
                <CalendarPanel fredEnabled={fredEnabled} />
                {grouped.map(({ category, items }) => (
                  <section key={category}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-chrome-muted">
                        {category}
                      </h2>
                      {category === "Equities" && (
                        <EquityViewToggle value={equityView} onChange={setEquityView} />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                      {items.map((ind) => (
                        <IndicatorCard key={ind.id} ind={ind} onClick={setSelected} />
                      ))}
                    </div>
                  </section>
                ))}
              </>
            )}
          </div>

          {/* Right rail: news */}
          <aside className="lg:sticky lg:top-[57px] lg:h-[calc(100vh-73px)]">
            <NewsFeed />
          </aside>
        </div>
      </main>

      {selected && <ChartModal ind={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
