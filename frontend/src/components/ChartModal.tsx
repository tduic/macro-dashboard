import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import { RANGES, type Indicator, type RangeKey } from "../types";
import { formatValue } from "../format";

function ChartTooltip({ active, payload, unit }: any) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded border border-chrome-border bg-chrome-panel px-2 py-1 text-xs shadow-lg">
      <div className="text-chrome-muted">{p.date}</div>
      <div className="font-mono text-white">{formatValue(p.value, unit)}</div>
    </div>
  );
}

export function ChartModal({
  ind,
  onClose,
}: {
  ind: Indicator;
  onClose: () => void;
}) {
  const [range, setRange] = useState<RangeKey>("1Y");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["history", ind.id, range],
    queryFn: () => api.history(ind.id, range),
    staleTime: 60_000,
  });

  const points = data?.points ?? [];
  const values = points.map((p) => p.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.02 || 1;
  const last = values.length ? values[values.length - 1] : 0;
  const first = values.length ? values[0] : 0;
  const lineColor = last >= first ? "#26d07c" : "#ff5c5c";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg border border-chrome-border bg-chrome-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-chrome-border p-4">
          <div>
            <div className="text-sm font-semibold text-white">{ind.label}</div>
            <div className="font-mono text-2xl font-bold tabular-nums text-white">
              {formatValue(ind.value, ind.unit)}
            </div>
            <div className="text-[11px] text-chrome-muted">
              {ind.category} · {ind.source} · as of {ind.asOf}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-chrome-muted hover:bg-chrome-card hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap gap-1 px-4 pt-3">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-2.5 py-1 font-mono text-xs transition-colors ${
                r === range
                  ? "bg-chrome-text text-chrome-bg"
                  : "border border-chrome-border text-chrome-muted hover:border-chrome-muted hover:text-white"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="h-[320px] w-full p-3">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-chrome-muted">
              loading…
            </div>
          ) : isError ? (
            <div className="flex h-full items-center justify-center text-sm text-down">
              failed to load history
            </div>
          ) : points.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-chrome-muted">
              no data for this range
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid stroke="#1f2733" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#5b6772", fontSize: 10 }}
                  minTickGap={48}
                  stroke="#1f2733"
                />
                <YAxis
                  domain={[min - pad, max + pad]}
                  tick={{ fill: "#5b6772", fontSize: 10 }}
                  width={56}
                  stroke="#1f2733"
                  tickFormatter={(v) => formatValue(Number(v), ind.unit)}
                />
                <Tooltip content={<ChartTooltip unit={ind.unit} />} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={lineColor}
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
