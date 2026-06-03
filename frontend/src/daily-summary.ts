// Synthesize a 1-sentence "what changed today" read from already-loaded data.
// No new endpoints; derives 1D moves from the sparkline (last point vs
// prior point) and picks driver headlines from the news rail by matching
// the mover's indicator keywords against the news topics.

import type { Indicator, NewsItem } from "./types";
import { getIndicatorKeywords } from "./indicator-keywords";

export interface MoverItem {
  ind: Indicator;
  pct: number;       // signed 1-day percent change
  driver?: NewsItem; // best matching news item, if any
}

function oneDayPct(ind: Indicator): number | null {
  const s = ind.sparkline;
  if (!s || s.length < 2) return null;
  const last = s[s.length - 1];
  const prev = s[s.length - 2];
  if (prev === 0) return null;
  return ((last - prev) / prev) * 100;
}

function pickDriver(ind: Indicator, news: NewsItem[]): NewsItem | undefined {
  const kws = getIndicatorKeywords(ind.id).map((k) => k.toLowerCase());
  if (!kws.length) return undefined;
  // News is already reverse-chron; first match is the most recent.
  return news.find((n) => {
    const t = n.title.toLowerCase();
    return kws.some((k) => t.includes(k));
  });
}

export function buildTopMovers(
  indicators: Indicator[],
  news: NewsItem[],
  k: number = 3,
): MoverItem[] {
  // Only price-type series — bps moves on yields aren't comparable as % moves.
  const candidates = indicators
    .filter((i) => i.changeType === "pct" && i.sparkline && i.sparkline.length >= 2)
    .map((i) => ({ ind: i, pct: oneDayPct(i) }))
    .filter((c): c is { ind: Indicator; pct: number } => c.pct != null && !Number.isNaN(c.pct));

  candidates.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  return candidates.slice(0, k).map((c) => ({
    ...c,
    driver: pickDriver(c.ind, news),
  }));
}

// One-sentence synopsis joining the top movers with their drivers.
// Example: "WTI -3.2% (oil price target cut on weak demand), Gold +1.8%,
// Nikkei +1.4% (Japan record high on Middle East concerns)."
export function summarizeMovers(movers: MoverItem[]): string {
  if (!movers.length) return "";
  return movers
    .map((m) => {
      const sign = m.pct >= 0 ? "+" : "";
      const stem = `${m.ind.label.split(" (")[0]} ${sign}${m.pct.toFixed(1)}%`;
      if (m.driver) {
        const short =
          m.driver.title.length > 70 ? m.driver.title.slice(0, 67) + "…" : m.driver.title;
        return `${stem} (${short})`;
      }
      return stem;
    })
    .join(" · ");
}
