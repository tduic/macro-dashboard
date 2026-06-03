import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { Indicator } from "../types";
import { buildTopMovers, type MoverItem } from "../daily-summary";

function Mover({ m }: { m: MoverItem }) {
  const sign = m.pct >= 0 ? "+" : "";
  const tone = m.pct >= 0 ? "text-up" : "text-down";
  const short = m.ind.label.split(" (")[0];
  return (
    <a
      href={m.driver?.url}
      target={m.driver ? "_blank" : undefined}
      rel="noopener noreferrer"
      className={`group inline-flex max-w-full items-baseline gap-1.5 rounded border border-chrome-border bg-chrome-card px-2 py-1 text-[11px] transition-colors ${
        m.driver ? "hover:border-chrome-muted hover:bg-[#18212c]" : ""
      }`}
      title={m.driver ? `${m.driver.source}: ${m.driver.title}` : undefined}
    >
      <span className="font-mono text-chrome-text">{short}</span>
      <span className={`font-mono font-semibold tabular-nums ${tone}`}>
        {sign}
        {m.pct.toFixed(2)}%
      </span>
      {m.driver && (
        <span className="hidden truncate text-chrome-muted sm:inline">
          · {m.driver.title.length > 50 ? m.driver.title.slice(0, 48) + "…" : m.driver.title}
        </span>
      )}
    </a>
  );
}

export function DailySummary({ indicators }: { indicators: Indicator[] }) {
  // Reuses the same react-query key as the rail, so no extra fetch.
  const newsQuery = useQuery({
    queryKey: ["news"],
    queryFn: api.news,
    staleTime: 5 * 60_000,
  });
  const news = newsQuery.data?.items ?? [];
  const movers = buildTopMovers(indicators, news, 3);
  if (movers.length === 0) return null;

  return (
    <section
      className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-chrome-border bg-chrome-panel px-3 py-2"
      aria-label="Today's biggest movers"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-chrome-muted">
        Today
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {movers.map((m) => (
          <Mover key={m.ind.id} m={m} />
        ))}
      </div>
    </section>
  );
}
