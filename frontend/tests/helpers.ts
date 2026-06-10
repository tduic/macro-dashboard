// Shared builders for the pure-logic unit tests.
import type { Indicator, NewsItem } from "../src/types";

export function ind(id: string, over: Partial<Indicator> = {}): Indicator {
  return {
    id,
    label: id,
    category: "Equities",
    value: 100,
    unit: "$",
    asOf: "2026-06-05",
    changeType: "pct",
    source: "test",
    change: { wow: null, mom: null, ytd: null },
    ...over,
  };
}

/** Indicator with a WoW % change (the regime strip's main input). */
export function withWow(id: string, pct: number, over: Partial<Indicator> = {}): Indicator {
  return ind(id, { change: { wow: { abs: pct, pct }, mom: null, ytd: null }, ...over });
}

/** Yield-style indicator: changeType bps, WoW carries abs bps and pct null. */
export function withWowBps(id: string, bps: number, over: Partial<Indicator> = {}): Indicator {
  return ind(id, {
    changeType: "bps",
    category: "Rates",
    unit: "%",
    change: { wow: { abs: bps, pct: null }, mom: null, ytd: null },
    ...over,
  });
}

export function newsItem(title: string, over: Partial<NewsItem> = {}): NewsItem {
  return {
    title,
    source: "Test",
    url: `https://example.com/${encodeURIComponent(title)}`,
    publishedAt: "2026-06-05T12:00:00+00:00",
    category: "Markets",
    topics: [],
    ...over,
  };
}
