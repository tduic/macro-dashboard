import type { Indicator } from "../types";
import { changeLabels, deltaColor, formatDelta, formatValue } from "../format";
import { Sparkline } from "./Sparkline";

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
  return (
    <button
      onClick={() => onClick(ind)}
      className="group flex w-full flex-col gap-2 rounded border border-chrome-border bg-chrome-card p-3 text-left transition-colors hover:border-chrome-muted hover:bg-[#18212c] focus:outline-none focus:ring-1 focus:ring-chrome-muted"
      title={`${ind.label} — source ${ind.source} — as of ${ind.asOf}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium text-chrome-text">{ind.label}</span>
        <span className="shrink-0 text-[10px] text-chrome-muted opacity-0 transition-opacity group-hover:opacity-100">
          chart ↗
        </span>
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
    </button>
  );
}
