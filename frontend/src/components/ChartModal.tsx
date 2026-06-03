import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import { RANGES, type EventItem, type Indicator, type NewsItem, type RangeKey } from "../types";
import { formatValue } from "../format";
import { findRelatedNews } from "../indicator-keywords";
import { NewsRow } from "./NewsFeed";

type Tab = "chart" | "news";

function ChartTooltip({
  active,
  payload,
  unit,
  compareUnit,
  compareLabel,
}: any) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded border border-chrome-border bg-chrome-panel px-2 py-1 text-xs shadow-lg">
      <div className="text-chrome-muted">{p.date}</div>
      <div className="font-mono text-white">{formatValue(p.value, unit)}</div>
      {p.compare != null && compareLabel && (
        <div className="font-mono text-[#7bb3ff]">
          {compareLabel.split(" (")[0]}: {formatValue(p.compare, compareUnit ?? "")}
        </div>
      )}
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
  const [tab, setTab] = useState<Tab>("chart");
  const [range, setRange] = useState<RangeKey>("1Y");
  const [compareId, setCompareId] = useState<string | null>(null);

  // News query uses the same key as the rail's, so this is a free read.
  const newsQuery = useQuery({
    queryKey: ["news"],
    queryFn: api.news,
    staleTime: 5 * 60_000,
  });
  const allNews: NewsItem[] = newsQuery.data?.items ?? [];
  const related = useMemo(() => findRelatedNews(allNews, ind.id), [allNews, ind.id]);

  // Cached: same key as App's indicators query, so this is a free read used
  // only to populate the compare picker.
  const indicatorsQuery = useQuery({
    queryKey: ["indicators"],
    queryFn: api.indicators,
    staleTime: 30_000,
  });
  const allIndicators = indicatorsQuery.data?.indicators ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg border border-chrome-border bg-chrome-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
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

        {/* Tabs */}
        <div className="flex border-b border-chrome-border px-3 pt-2" role="tablist">
          <TabButton id="chart" current={tab} onClick={setTab} label="Chart" />
          <TabButton
            id="news"
            current={tab}
            onClick={setTab}
            label="Related News"
            count={related.length}
          />
        </div>

        {tab === "chart" ? (
          <ChartView
            ind={ind}
            range={range}
            onRangeChange={setRange}
            compareId={compareId}
            onCompareChange={setCompareId}
            allIndicators={allIndicators}
          />
        ) : (
          <RelatedNewsView related={related} isLoading={newsQuery.isLoading} indId={ind.id} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  id,
  current,
  onClick,
  label,
  count,
}: {
  id: Tab;
  current: Tab;
  onClick: (t: Tab) => void;
  label: string;
  count?: number;
}) {
  const active = id === current;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => onClick(id)}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs uppercase tracking-wide transition-colors ${
        active
          ? "border-chrome-text text-white"
          : "border-transparent text-chrome-muted hover:text-white"
      }`}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span className="rounded bg-chrome-card px-1 py-0.5 font-mono text-[9px]">{count}</span>
      )}
    </button>
  );
}

// Event styling. Only FOMC (rare, market-moving) gets an inline label;
// release dates render as faint vertical ticks so the chart stays readable.
// FOMC stands out (gold, labeled). Other release dates are visible but
// quieter — small color tint per release type, no inline label so a busy
// year-long window doesn't pile up overlapping text.
const EVENT_STYLE: Record<
  string,
  { stroke: string; strokeWidth: number; opacity: number; dash: string; label: boolean }
> = {
  FOMC:   { stroke: "#e0b340", strokeWidth: 1.25, opacity: 1.00, dash: "3 3", label: true  },
  CPI:    { stroke: "#7b9aff", strokeWidth: 1,    opacity: 0.55, dash: "2 4", label: false },
  PCE:    { stroke: "#7b9aff", strokeWidth: 1,    opacity: 0.55, dash: "2 4", label: false },
  PPI:    { stroke: "#7b9aff", strokeWidth: 1,    opacity: 0.45, dash: "2 4", label: false },
  NFP:    { stroke: "#9a7bff", strokeWidth: 1,    opacity: 0.55, dash: "2 4", label: false },
  RETAIL: { stroke: "#9a7bff", strokeWidth: 1,    opacity: 0.45, dash: "2 4", label: false },
  GDP:    { stroke: "#26d07c", strokeWidth: 1,    opacity: 0.55, dash: "2 4", label: false },
};
const DEFAULT_EVENT_STYLE = EVENT_STYLE.CPI;

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-[8px] w-[8px] rounded-sm" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}

function snapEventsToPoints(
  events: EventItem[],
  pointDates: string[],
): { date: string; type: string }[] {
  if (!pointDates.length) return [];
  const firstD = pointDates[0];
  const lastD = pointDates[pointDates.length - 1];
  const out: { date: string; type: string }[] = [];
  for (const ev of events) {
    if (ev.date < firstD || ev.date > lastD) continue;
    // first point on or after the event date (binary search would be nicer but
    // pointDates is bounded by chart range so this is fine)
    let snap = pointDates.find((d) => d >= ev.date);
    if (!snap) snap = lastD;
    out.push({ date: snap, type: ev.type });
  }
  return out;
}

const COMPARE_COLOR = "#7bb3ff";

function ChartView({
  ind,
  range,
  onRangeChange,
  compareId,
  onCompareChange,
  allIndicators,
}: {
  ind: Indicator;
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  compareId: string | null;
  onCompareChange: (id: string | null) => void;
  allIndicators: Indicator[];
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["history", ind.id, range],
    queryFn: () => api.history(ind.id, range),
    staleTime: 60_000,
  });

  const compareQuery = useQuery({
    queryKey: ["history", compareId, range],
    queryFn: () => api.history(compareId!, range),
    enabled: !!compareId,
    staleTime: 60_000,
  });

  const [showEvents, setShowEvents] = useState(true);

  const points = data?.points ?? [];
  const values = points.map((p) => p.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.02 || 1;
  const last = values.length ? values[values.length - 1] : 0;
  const first = values.length ? values[0] : 0;
  const lineColor = last >= first ? "#26d07c" : "#ff5c5c";

  // Merge compare series onto primary by date with forward-fill (handles
  // monthly-vs-daily mismatches without breaking the line). Returns the same
  // shape regardless so chart props stay uniform.
  type Row = { date: string; value: number; compare?: number };
  const merged: Row[] = useMemo(() => {
    const comparePoints = compareQuery.data?.points ?? [];
    if (!compareId || comparePoints.length === 0) {
      return points.map((p) => ({ date: p.date, value: p.value }));
    }
    let j = 0;
    let lastVal: number | undefined;
    return points.map((p) => {
      while (j < comparePoints.length && comparePoints[j].date <= p.date) {
        lastVal = comparePoints[j].value;
        j++;
      }
      return { date: p.date, value: p.value, compare: lastVal };
    });
  }, [points, compareQuery.data, compareId]);

  const compareInd = compareId ? allIndicators.find((i) => i.id === compareId) : null;
  const compareValues = merged
    .map((p) => p.compare)
    .filter((v): v is number => v != null);
  const cMin = compareValues.length ? Math.min(...compareValues) : 0;
  const cMax = compareValues.length ? Math.max(...compareValues) : 1;
  const cPad = (cMax - cMin) * 0.08 || Math.abs(cMax) * 0.02 || 1;

  const fromDate = points[0]?.date ?? "";
  const toDate = points[points.length - 1]?.date ?? "";

  const eventsQuery = useQuery({
    queryKey: ["events", fromDate, toDate],
    queryFn: () => api.events(fromDate, toDate),
    enabled: showEvents && !!fromDate && !!toDate,
    staleTime: 60 * 60_000, // events don't move within an hour
  });

  const snapped = useMemo(() => {
    if (!showEvents) return [];
    const evs = eventsQuery.data?.events ?? [];
    return snapEventsToPoints(evs, points.map((p) => p.date));
  }, [showEvents, eventsQuery.data, points]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 px-4 pt-3">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => onRangeChange(r)}
            className={`rounded px-2.5 py-1 font-mono text-xs transition-colors ${
              r === range
                ? "bg-chrome-text text-chrome-bg"
                : "border border-chrome-border text-chrome-muted hover:border-chrome-muted hover:text-white"
            }`}
          >
            {r}
          </button>
        ))}
        <select
          value={compareId ?? ""}
          onChange={(e) => onCompareChange(e.target.value || null)}
          className="ml-auto rounded border border-chrome-border bg-chrome-card px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-chrome-text hover:border-chrome-muted"
          title="Overlay another indicator on a second axis"
        >
          <option value="">Compare: —</option>
          {allIndicators
            .filter((i) => i.id !== ind.id)
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
        </select>
        <button
          onClick={() => setShowEvents((v) => !v)}
          className={`rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
            showEvents
              ? "border-chrome-text bg-chrome-text/10 text-chrome-text"
              : "border-chrome-border text-chrome-muted hover:text-white"
          }`}
          title="Toggle FOMC + macro release date overlays"
        >
          Events {showEvents ? "on" : "off"}
        </button>
      </div>

      {showEvents && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-1 font-mono text-[10px] text-chrome-muted">
          <LegendDot color="#e0b340" label="FOMC" />
          <LegendDot color="#7b9aff" label="CPI / PCE / PPI" />
          <LegendDot color="#9a7bff" label="NFP / Retail" />
          <LegendDot color="#26d07c" label="GDP" />
        </div>
      )}

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
            <LineChart data={merged} margin={{ top: 22, right: compareInd ? 56 : 12, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="#1f2733" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "#5b6772", fontSize: 10 }}
                minTickGap={48}
                stroke="#1f2733"
              />
              <YAxis
                yAxisId="left"
                domain={[min - pad, max + pad]}
                tick={{ fill: "#5b6772", fontSize: 10 }}
                width={56}
                stroke="#1f2733"
                tickFormatter={(v) => formatValue(Number(v), ind.unit)}
              />
              {compareInd && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[cMin - cPad, cMax + cPad]}
                  tick={{ fill: COMPARE_COLOR, fontSize: 10 }}
                  width={56}
                  stroke="#1f2733"
                  tickFormatter={(v) => formatValue(Number(v), compareInd.unit)}
                />
              )}
              <Tooltip content={<ChartTooltip unit={ind.unit} compareUnit={compareInd?.unit} compareLabel={compareInd?.label} />} />
              {snapped.map((e, i) => {
                const st = EVENT_STYLE[e.type] ?? DEFAULT_EVENT_STYLE;
                return (
                  <ReferenceLine
                    key={`${e.date}-${e.type}-${i}`}
                    x={e.date}
                    stroke={st.stroke}
                    strokeOpacity={st.opacity}
                    strokeWidth={st.strokeWidth}
                    strokeDasharray={st.dash}
                    label={
                      st.label
                        ? { value: e.type, position: "top", fill: st.stroke, fontSize: 10 }
                        : undefined
                    }
                  />
                );
              })}
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={1.6}
                dot={false}
                isAnimationActive={false}
              />
              {compareInd && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="compare"
                  stroke={COMPARE_COLOR}
                  strokeWidth={1.4}
                  strokeOpacity={0.85}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  );
}

function RelatedNewsView({
  related,
  isLoading,
  indId,
}: {
  related: NewsItem[];
  isLoading: boolean;
  indId: string;
}) {
  return (
    <div className="max-h-[420px] overflow-y-auto">
      {isLoading ? (
        <div className="p-4 text-sm text-chrome-muted">loading…</div>
      ) : related.length === 0 ? (
        <div className="p-4 text-sm text-chrome-muted">
          No related news in the current feed for{" "}
          <span className="font-mono">{indId}</span>. Try refreshing — the feed updates every ~10
          minutes.
        </div>
      ) : (
        <ul className="divide-y divide-chrome-border">
          {related.map((it, i) => (
            <NewsRow key={`${it.url}-${i}`} item={it} />
          ))}
        </ul>
      )}
    </div>
  );
}
