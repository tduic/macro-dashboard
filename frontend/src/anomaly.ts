// Detect "the last move is unusually large" anomalies from each indicator's
// sparkline. Computes daily log-returns over the trailing ~30 points, then
// flags the latest move if it's outside ±2σ of that distribution.
//
// All client-side from data already on the card — no backend work.

import type { Indicator } from "./types";

export interface Anomaly {
  zScore: number;     // signed z-score of latest 1-day move
  pct: number;        // signed 1-day percent change
  severity: "warn" | "extreme"; // |z| ≥ 2 / ≥ 3
}

export function detectAnomaly(ind: Indicator): Anomaly | null {
  const s = ind.sparkline;
  if (!s || s.length < 8) return null;

  // log-returns
  const rets: number[] = [];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1];
    const b = s[i];
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 6) return null;

  // Use the *prior* rets (exclude latest) for the baseline so the latest
  // move doesn't pull the mean / std toward itself.
  const baseline = rets.slice(0, -1);
  const last = rets[rets.length - 1];
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance =
    baseline.reduce((acc, r) => acc + (r - mean) ** 2, 0) / Math.max(1, baseline.length - 1);
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std < 1e-8) return null;

  const z = (last - mean) / std;
  const absZ = Math.abs(z);
  if (absZ < 2) return null;

  // convert log-return back to a friendly % move
  const pct = (Math.exp(last) - 1) * 100;
  return {
    zScore: Number(z.toFixed(2)),
    pct: Number(pct.toFixed(2)),
    severity: absZ >= 3 ? "extreme" : "warn",
  };
}
