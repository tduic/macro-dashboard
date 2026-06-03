// Decide whether each indicator's most recent observation is uncomfortably old.
// We don't know the publisher's exact cadence per ID, so we infer from category:
//   Daily series   (Equities, Rates, FX, Energy & Metals, Ags / Softs,
//                   Credit, Global Equities, Crypto, Ratios)
//     fresh   asOf within last 1 cal day
//     stale   asOf > 4 cal days old
//   Monthly releases (Economic Data)
//     fresh   asOf within last ~40 days
//     stale   asOf > 75 days old
//
// Returns { state: "fresh" | "weekend" | "stale", ageDays } so the UI can
// tint and badge accordingly.

import type { Indicator } from "./types";

export type Stale = "fresh" | "weekend" | "stale";

export interface Freshness {
  state: Stale;
  ageDays: number;
}

const MONTHLY_CATEGORIES = new Set(["Economic Data"]);
const CRYPTO_CATEGORIES = new Set(["Crypto"]); // 24/7 markets, no weekend tolerance

function diffDaysUTC(iso: string): number {
  const a = new Date(iso + "T00:00:00Z").getTime();
  const b = Date.now();
  return Math.floor((b - a) / 86400_000);
}

export function freshness(ind: Indicator): Freshness {
  const age = diffDaysUTC(ind.asOf);
  if (MONTHLY_CATEGORIES.has(ind.category)) {
    if (age <= 40) return { state: "fresh", ageDays: age };
    if (age <= 75) return { state: "weekend", ageDays: age };
    return { state: "stale", ageDays: age };
  }
  // Daily-frequency series.
  if (age <= 1) return { state: "fresh", ageDays: age };
  // Weekend tolerance for non-crypto daily markets: prints often come Fri
  // and you load on Sunday → asOf = 2 days old is fine.
  if (!CRYPTO_CATEGORIES.has(ind.category) && age <= 4) {
    return { state: "weekend", ageDays: age };
  }
  return { state: "stale", ageDays: age };
}
