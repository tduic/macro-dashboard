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
  const [tab, setTab] = useState<Tab>("chart");
  const [range, setRange] = useState<RangeKey>("1Y");

  // News query uses the same key as the rail's, so this is a free read.
  const newsQuery = useQuery({
    queryKey: ["news"],
    queryFn: api.news,
    staleTime: 5 * 60_000,
  });
  const allNews: NewsItem[] = newsQuery.data?.items ?? [];
  const related = useMemo(() => findRelatedNews(allNews, ind.id), [allNews, ind.id]);

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
          <ChartView ind={ind} range={range} onRangeChange={setRange} />
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

// Event style by type. FOMC gets a stronger accent; all others uniform.
const EVENT_COLOR: Record<string, string> = {
  FOMC: "#e0b340",
  CPI: "#5b6772",
  PCE: "#5b6772",
  PPI: "#5b6772",
  NFP: "#5b6772",
  RETAIL: "#5b6772",
  GDP: "#5b6772",
};

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

function ChartView({
  ind,
  range,
  onRangeChange,
}: {
  ind: Indicator;
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["history", ind.id, range],
    queryFn: () => api.history(ind.id, range),
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
        <button
          onClick={() => setShowEvents((v) => !v)}
          className={`ml-auto rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors ${
            showEvents
              ? "border-chrome-text bg-chrome-text/10 text-chrome-text"
              : "border-chrome-border text-chrome-muted hover:text-white"
          }`}
          title="Toggle FOMC + macro release date overlays"
        >
          Events {showEvents ? "on" : "off"}
        </button>
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
              {snapped.map((e, i) => (
                <ReferenceLine
                  key={`${e.date}-${e.type}-${i}`}
                  x={e.date}
                  stroke={EVENT_COLOR[e.type] ?? "#5b6772"}
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  label={{
                    value: e.type,
                    position: "top",
                    fill: EVENT_COLOR[e.type] ?? "#5b6772",
                    fontSize: 9,
                  }}
                />
              ))}
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
