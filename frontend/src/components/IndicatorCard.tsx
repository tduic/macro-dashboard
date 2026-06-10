import type { Indicator } from "../types";
import { changeLabels, deltaColor, formatDelta, formatValue } from "../format";
import { Sparkline } from "./Sparkline";
import { PercentileBar } from "./PercentileBar";
import { detectAnomaly } from "../anomaly";
import { freshness } from "../staleness";

function DeltaCell({
  label,
  ind,
  slot,
}: {
  label: string;
  ind: Indicator;
  slot: "wow" | "mom" | "ytd";
}) {
  const d = formatDelta(ind.change[slot], ind.changeType);
  return (
    <div className="flex flex-col items-start">
      <span className="text-[10px] uppercase tracking-wide text-chrome-muted">{label}</span>
      <span className={`font-mono text-xs ${d ? deltaColor(d.sign) : "text-chrome-muted"}`}>
        {d ? d.text : "—"}
      </span>
    </div>
  );
}

export function IndicatorCard({
  ind,
  onClick,
}: {
  ind: Indicator;
  onClick: (ind: Indicator) => void;
}) {
  const labels = changeLabels(ind);
  const anomaly = detectAnomaly(ind);
  const fresh = freshness(ind);
  const isStale = fresh.state === "stale";
  const borderClass = anomaly
    ? anomaly.severity === "extreme"
      ? "border-down/70 hover:border-down"
      : "border-down/40 hover:border-down/70"
    : isStale
      ? "border-yellow-600/50 hover:border-yellow-500"
      : "border-chrome-border hover:border-chrome-muted";
  const cardClass = isStale ? "bg-yellow-950/15" : "bg-chrome-card";
  return (
    <button
      onClick={() => onClick(ind)}
      className={`group flex w-full flex-col gap-2 rounded border p-3 text-left transition-colors hover:bg-[#18212c] focus:outline-none focus:ring-1 focus:ring-chrome-muted ${borderClass} ${cardClass}`}
      title={
        isStale
          ? `${ind.label} — data is ${fresh.ageDays}d old (source ${ind.source}). May not have refreshed; tap to view full history.`
          : anomaly
            ? `${ind.label} — ${anomaly.pct >= 0 ? "+" : ""}${anomaly.pct.toFixed(2)}% (z=${anomaly.zScore}) vs trailing 30d. Source ${ind.source}.`
            : `${ind.label} — source ${ind.source} — as of ${ind.asOf}`
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1 truncate text-xs font-medium text-chrome-text">
          {anomaly && (
            <span
              className={`shrink-0 font-mono text-[10px] ${
                anomaly.severity === "extreme" ? "text-down" : "text-yellow-400"
              }`}
              aria-label="anomalous move"
            >
              ⚠
            </span>
          )}
          <span className="truncate">{ind.label}</span>
        </span>
        {isStale ? (
          <span
            className="shrink-0 rounded bg-yellow-900/40 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-yellow-300"
            title={`as of ${ind.asOf} (${fresh.ageDays}d old)`}
          >
            {fresh.ageDays}d old
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-chrome-muted opacity-0 transition-opacity group-hover:opacity-100">
            chart ↗
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="font-mono text-xl font-semibold tabular-nums text-white">
          {formatValue(ind.value, ind.unit)}
        </div>
        {ind.sparkline && ind.sparkline.length > 1 && (
          <Sparkline values={ind.sparkline} />
        )}
      </div>
      <div className="grid grid-cols-3 gap-1 border-t border-chrome-border pt-2">
        <DeltaCell label={labels.wow} ind={ind} slot="wow" />
        <DeltaCell label={labels.mom} ind={ind} slot="mom" />
        <DeltaCell label={labels.ytd} ind={ind} slot="ytd" />
      </div>
      {ind.percentile && (
        <PercentileBar pct={ind.percentile.value} window={ind.percentile.window} />
      )}
      {ind.drawdown && ind.drawdown.pct <= -0.5 && (
        <div
          className={`font-mono text-[10px] tabular-nums ${
            ind.drawdown.pct <= -5 ? "text-down/80" : "text-chrome-muted"
          }`}
          title={`off the trailing-1Y high set ${ind.drawdown.peakDate}`}
        >
          ▼{Math.abs(ind.drawdown.pct).toFixed(1)}% off 1Y hi
        </div>
      )}
    </button>
  );
}
