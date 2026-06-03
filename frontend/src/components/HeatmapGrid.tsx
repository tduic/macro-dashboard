import { useMemo, useState } from "react";
import type { Indicator } from "../types";
import { formatValue } from "../format";
import { heatmapColor } from "../heatmap-color";

type Metric = "wow" | "mom" | "ytd";

const METRIC_LABELS: Record<Metric, string> = {
  wow: "1W",
  mom: "MoM",
  ytd: "YTD",
};

export function HeatmapGrid({
  indicators,
  onSelect,
}: {
  indicators: Indicator[];
  onSelect: (i: Indicator) => void;
}) {
  const [metric, setMetric] = useState<Metric>("ytd");

  // Heatmap shows only % series (excludes yields/bps and unrelated levels);
  // sorted desc by chosen metric so the best performers are on top.
  const cells = useMemo(() => {
    return indicators
      .filter((i) => i.changeType === "pct")
      .map((i) => ({ ind: i, pct: i.change[metric]?.pct ?? null }))
      .filter((c): c is { ind: Indicator; pct: number } => c.pct != null)
      .sort((a, b) => b.pct - a.pct);
  }, [indicators, metric]);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-chrome-muted">
          Heatmap
        </h2>
        <span className="text-chrome-border">·</span>
        <div className="inline-flex items-center gap-0.5 rounded border border-chrome-border bg-chrome-card p-0.5">
          {(["wow", "mom", "ytd"] as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                m === metric
                  ? "bg-chrome-text text-chrome-bg"
                  : "text-chrome-muted hover:text-white"
              }`}
              aria-selected={m === metric}
              role="tab"
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-chrome-muted">
          sorted by {METRIC_LABELS[metric].toLowerCase()} · {cells.length} markets · yields (bps)
          shown in Grid view
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6">
        {cells.map(({ ind, pct }) => (
          <button
            key={ind.id}
            onClick={() => onSelect(ind)}
            style={{ background: heatmapColor(pct) }}
            className="group flex flex-col items-start gap-0.5 rounded border border-chrome-border/40 p-2 text-left transition-colors hover:border-chrome-text"
            title={`${ind.label} — ${ind.category}`}
          >
            <span className="w-full truncate text-[10px] uppercase tracking-wide text-chrome-text/80">
              {ind.label}
            </span>
            <span className="font-mono text-xs tabular-nums text-white/80">
              {formatValue(ind.value, ind.unit)}
            </span>
            <span
              className={`font-mono text-base font-bold tabular-nums ${
                pct >= 0 ? "text-up" : "text-down"
              }`}
            >
              {pct >= 0 ? "+" : ""}
              {pct.toFixed(2)}%
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
