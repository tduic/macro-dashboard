import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { EquityView, Indicator } from "./types";
import { formatClock } from "./format";
import { IndicatorCard } from "./components/IndicatorCard";
import { ChartModal } from "./components/ChartModal";
import { NewsFeed } from "./components/NewsFeed";
import { CalendarPanel } from "./components/CalendarPanel";
import { RegimeStrip } from "./components/RegimeStrip";
import { HeatmapGrid } from "./components/HeatmapGrid";
import { DailySummary } from "./components/DailySummary";
import { YieldCurvePanel } from "./components/YieldCurvePanel";
import { useIsCompact } from "./useMediaQuery";

type ViewMode = "grid" | "heatmap";
type MobileTab = "markets" | "news";
const VIEW_MODE_STORAGE = "macro:viewMode";
const EQUITY_VIEW_STORAGE = "macro:equityView";

const CATEGORY_ORDER = [
  "Equities",
  "Global Equities",
  "Rates",
  "Credit",
  "FX",
  "Energy & Metals",
  "Ags / Softs",
  "Economic Data",
  "Crypto",
  "Ratios",
];

function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const opts: { id: ViewMode; label: string }[] = [
    { id: "grid", label: "Grid" },
    { id: "heatmap", label: "Heatmap" },
  ];
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded border border-chrome-border bg-chrome-card p-0.5"
      role="tablist"
      aria-label="View mode"
    >
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-selected={o.id === value}
          role="tab"
          className={`min-h-[28px] rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
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
          className={`min-h-[28px] rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
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

function MobileTabBar({
  value,
  onChange,
  newsCount,
}: {
  value: MobileTab;
  onChange: (t: MobileTab) => void;
  newsCount: number;
}) {
  const tabs: { id: MobileTab; label: string; badge?: number }[] = [
    { id: "markets", label: "Markets" },
    { id: "news", label: "News", badge: newsCount || undefined },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-chrome-border bg-chrome-panel/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6px)" }}
      aria-label="View"
    >
      <div className="mx-auto flex max-w-[640px] items-stretch gap-1 px-3 pt-1.5">
        {tabs.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-md px-3 py-2 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-chrome-card text-white"
                  : "text-chrome-muted active:bg-chrome-card/60"
              }`}
            >
              <span className="text-base leading-none" aria-hidden="true">
                {t.id === "markets" ? "▦" : "📰"}
              </span>
              <span className="flex items-baseline gap-1">
                <span>{t.label}</span>
                {t.badge != null && (
                  <span className="font-mono text-[9px] opacity-60">{t.badge}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default function App() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Indicator | null>(null);
  const isCompact = useIsCompact();

  // Equities toggle (persisted)
  const [equityView, setEquityView] = useState<EquityView>(() => {
    if (typeof window === "undefined") return "index";
    const v = window.localStorage.getItem(EQUITY_VIEW_STORAGE);
    return v === "etf" ? "etf" : "index";
  });
  useEffect(() => {
    window.localStorage.setItem(EQUITY_VIEW_STORAGE, equityView);
  }, [equityView]);

  // Grid / Heatmap (persisted)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    const v = window.localStorage.getItem(VIEW_MODE_STORAGE);
    return v === "heatmap" ? "heatmap" : "grid";
  });
  useEffect(() => {
    window.localStorage.setItem(VIEW_MODE_STORAGE, viewMode);
  }, [viewMode]);

  // Mobile bottom-tab pick. Always default to Markets on resize-into-compact.
  const [mobileTab, setMobileTab] = useState<MobileTab>("markets");

  const { data, isLoading, isError, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ["indicators"],
    queryFn: api.indicators,
    refetchInterval: 60_000, // auto-refresh market data every 60s
    staleTime: 30_000,
  });

  const newsQuery = useQuery({
    queryKey: ["news"],
    queryFn: api.news,
    staleTime: 5 * 60_000,
  });
  const newsCount = newsQuery.data?.count ?? 0;

  const indicators = data?.indicators ?? [];
  const fredEnabled = data?.fredEnabled ?? false;

  const grouped = useMemo(() => {
    const map = new Map<string, Indicator[]>();
    for (const ind of indicators) {
      if (ind.category === "Equities" && ind.group && ind.group !== equityView) continue;
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

  const markets = (
    <div className="flex flex-col gap-4 sm:gap-5">
      {isLoading ? (
        <div className="py-20 text-center text-sm text-chrome-muted">loading markets…</div>
      ) : isError ? (
        <div className="py-20 text-center text-sm text-down">
          failed to load indicators — is the backend running on :8000?
        </div>
      ) : (
        <>
          <DailySummary indicators={indicators} />
          <RegimeStrip indicators={indicators} />
          <CalendarPanel fredEnabled={fredEnabled} />
          {viewMode === "heatmap" ? (
            <HeatmapGrid indicators={indicators} onSelect={setSelected} />
          ) : (
            grouped.map(({ category, items }) => (
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
                {category === "Rates" && fredEnabled && (
                  <div className="mt-3">
                    <YieldCurvePanel />
                  </div>
                )}
              </section>
            ))
          )}
        </>
      )}
    </div>
  );

  return (
    <div
      className="min-h-screen bg-chrome-bg text-chrome-text"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-chrome-border bg-chrome-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-2 px-4 py-2.5">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-sm font-bold tracking-tight text-white">
              MACRO<span className="text-up">·</span>DESK
            </span>
            <span className="hidden font-mono text-[11px] text-chrome-muted sm:inline">
              global macro tracker
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <ViewToggle value={viewMode} onChange={setViewMode} />
            <span className="hidden font-mono text-[11px] text-chrome-muted sm:inline">
              {isFetching
                ? "refreshing…"
                : `updated ${formatClock(new Date(dataUpdatedAt).toISOString())}`}
            </span>
            <button
              onClick={handleRefresh}
              aria-label="Refresh"
              className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded border border-chrome-border px-2.5 py-1 font-mono text-xs text-chrome-text hover:border-chrome-muted hover:text-white active:bg-chrome-card"
            >
              ↻<span className="ml-1 hidden sm:inline">refresh</span>
            </button>
          </div>
        </div>
      </header>

      <main
        className="mx-auto max-w-[1600px] px-3 py-3 sm:px-4 sm:py-4"
        style={{ paddingBottom: isCompact ? "calc(env(safe-area-inset-bottom) + 76px)" : undefined }}
      >
        {!isLoading && !fredEnabled && (
          <div className="mb-4">
            <FredBanner />
          </div>
        )}

        {isCompact ? (
          // Mobile / tablet: tab-bar swap between Markets and News
          mobileTab === "markets" ? (
            markets
          ) : (
            <div className="h-[calc(100vh-180px)]">
              <NewsFeed />
            </div>
          )
        ) : (
          // Desktop: side-by-side layout
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
            {markets}
            <aside className="lg:sticky lg:top-[57px] lg:h-[calc(100vh-73px)]">
              <NewsFeed />
            </aside>
          </div>
        )}
      </main>

      {isCompact && (
        <MobileTabBar value={mobileTab} onChange={setMobileTab} newsCount={newsCount} />
      )}

      {selected && <ChartModal ind={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
