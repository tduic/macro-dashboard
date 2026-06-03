import { useMemo, useState } from "react";
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
import type { CurveSnapshotKey } from "../types";

const SNAPSHOT_LABEL: Record<CurveSnapshotKey, string> = {
  current: "Now",
  "1W": "1W ago",
  "1M": "1M ago",
  "3M": "3M ago",
  YE: "Year-end",
};

const SNAPSHOT_COLOR: Record<CurveSnapshotKey, string> = {
  current: "#26d07c",
  "1W": "#7bb3ff",
  "1M": "#9a7bff",
  "3M": "#e0b340",
  YE: "#ff5c5c",
};

const ALL_SNAPSHOTS: CurveSnapshotKey[] = ["current", "1W", "1M", "3M", "YE"];

export function YieldCurvePanel() {
  const [active, setActive] = useState<Set<CurveSnapshotKey>>(
    () => new Set<CurveSnapshotKey>(["current", "1M", "YE"]),
  );

  const { data } = useQuery({
    queryKey: ["ust-curve"],
    queryFn: api.ustCurve,
    staleTime: 6 * 60 * 60_000,
  });

  // Merge all selected snapshots into one row-per-tenor data set so Recharts
  // can draw multiple lines from a single dataset.
  const rows = useMemo(() => {
    if (!data?.enabled || !data.curves || !data.tenors) return [];
    return data.tenors.map((t) => {
      const row: Record<string, number | string> = { tenor: t };
      for (const key of ALL_SNAPSHOTS) {
        const pts = data.curves?.[key];
        const p = pts?.find((x) => x.tenor === t);
        if (p) row[key] = p.yield;
      }
      return row;
    });
  }, [data]);

  if (!data?.enabled) return null;

  function toggle(k: CurveSnapshotKey) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      if (next.size === 0) next.add("current");
      return next;
    });
  }

  return (
    <section className="rounded-lg border border-chrome-border bg-chrome-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-chrome-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-chrome-text">
          UST Yield Curve
        </h2>
        <div className="flex flex-wrap gap-1">
          {ALL_SNAPSHOTS.map((k) => (
            <button
              key={k}
              onClick={() => toggle(k)}
              className={`flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                active.has(k)
                  ? "border-chrome-text/60 bg-chrome-card text-white"
                  : "border-chrome-border text-chrome-muted hover:text-white"
              }`}
              style={
                active.has(k)
                  ? { boxShadow: `inset 0 -2px 0 ${SNAPSHOT_COLOR[k]}` }
                  : undefined
              }
            >
              <span className="inline-block h-[8px] w-[8px] rounded-sm" style={{ background: SNAPSHOT_COLOR[k] }} />
              <span>{SNAPSHOT_LABEL[k]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="h-[180px] w-full p-2 sm:h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="#1f2733" vertical={false} />
            <XAxis dataKey="tenor" tick={{ fill: "#5b6772", fontSize: 10 }} stroke="#1f2733" />
            <YAxis
              tick={{ fill: "#5b6772", fontSize: 10 }}
              width={40}
              stroke="#1f2733"
              tickFormatter={(v) => `${Number(v).toFixed(2)}%`}
            />
            <Tooltip
              contentStyle={{
                background: "#0f141b",
                border: "1px solid #1f2733",
                fontSize: 11,
              }}
              labelStyle={{ color: "#c7d0d9" }}
              formatter={(v: unknown) => {
                if (typeof v === "number") return [`${v.toFixed(3)}%`, ""];
                return [String(v ?? ""), ""];
              }}
            />
            {ALL_SNAPSHOTS.filter((k) => active.has(k)).map((k) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                name={SNAPSHOT_LABEL[k]}
                stroke={SNAPSHOT_COLOR[k]}
                strokeWidth={k === "current" ? 1.8 : 1.2}
                strokeOpacity={k === "current" ? 1 : 0.85}
                strokeDasharray={k === "current" ? undefined : "3 3"}
                dot={{ r: k === "current" ? 2.5 : 1.5, fill: SNAPSHOT_COLOR[k] }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="border-t border-chrome-border px-3 py-1 text-[10px] text-chrome-muted">
        as of {data.asOf} · {data.tenors?.join(" · ")}
      </div>
    </section>
  );
}
