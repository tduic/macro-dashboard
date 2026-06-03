// A thin horizontal bar with a tick at the percentile position. Shows how
// extreme the current value is vs its trailing window. Edges are colored:
// red at the high end (overheated), green at the low end (cheap), gray in
// the middle. Reading: a tick at 95% = at a 1Y high; tick at 5% = 1Y low.

type Props = {
  pct: number;        // 0–100
  window: string;     // "1Y", "2Y"
  width?: number;
  className?: string;
};

export function PercentileBar({ pct, window, width = 92, className }: Props) {
  const clamped = Math.max(0, Math.min(100, pct));
  const tone =
    clamped >= 80 ? "text-down" : clamped <= 20 ? "text-up" : "text-chrome-muted";
  return (
    <div className={`flex flex-col gap-0.5 ${className ?? ""}`} style={{ width }}>
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] uppercase tracking-wide text-chrome-muted">{window} %ile</span>
        <span className={`font-mono text-[10px] tabular-nums ${tone}`}>
          {Math.round(clamped)}
        </span>
      </div>
      <div className="relative h-1.5 rounded-sm bg-chrome-border/60" aria-hidden="true">
        {/* gradient: cool green (cheap) -> gray -> hot red (rich) */}
        <div
          className="absolute inset-0 rounded-sm opacity-50"
          style={{
            background:
              "linear-gradient(to right, rgba(38,208,124,0.5), rgba(91,103,114,0.35) 50%, rgba(255,92,92,0.5))",
          }}
        />
        <div
          className="absolute top-[-2px] h-3 w-0.5 rounded-sm bg-white"
          style={{ left: `calc(${clamped}% - 1px)` }}
        />
      </div>
    </div>
  );
}
