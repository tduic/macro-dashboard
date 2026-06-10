import { describe, expect, it } from "vitest";
import { detectAnomaly } from "../src/anomaly";
import { ind } from "./helpers";

// Build a sparkline whose first 7 log-returns alternate ±a (the baseline
// noise) and whose final return is `lastRet`. 9 points -> 8 returns, baseline
// = first 7. Baseline mean = a/7, std ≈ 1.069a, so z ≈ (lastRet - a/7)/(1.069a).
function spark(lastRet: number, a = 0.01): number[] {
  const pts = [100];
  for (let i = 0; i < 7; i++) {
    pts.push(pts[pts.length - 1] * Math.exp(i % 2 === 0 ? a : -a));
  }
  pts.push(pts[pts.length - 1] * Math.exp(lastRet));
  return pts;
}

const withSpark = (s: number[]) => ind("SPY", { sparkline: s });

describe("detectAnomaly", () => {
  it("returns null when the last move is inside ±2σ", () => {
    // lastRet ≈ 1.3σ above the mean — normal noise
    expect(detectAnomaly(withSpark(spark(0.015)))).toBeNull();
    // and an ordinary baseline-sized move
    expect(detectAnomaly(withSpark(spark(0.01)))).toBeNull();
  });

  it("flags a 2σ–3σ move as warn with the right sign", () => {
    // lastRet ≈ mean + 2.5σ
    const a = detectAnomaly(withSpark(spark(0.0282)));
    expect(a).not.toBeNull();
    expect(a!.severity).toBe("warn");
    expect(a!.zScore).toBeGreaterThanOrEqual(2);
    expect(a!.zScore).toBeLessThan(3);
    expect(a!.pct).toBeCloseTo((Math.exp(0.0282) - 1) * 100, 1);
  });

  it("flags a huge move as extreme (|z| ≥ 3)", () => {
    const a = detectAnomaly(withSpark(spark(Math.log(1.1)))); // +10% day
    expect(a).not.toBeNull();
    expect(a!.severity).toBe("extreme");
    expect(a!.zScore).toBeGreaterThanOrEqual(3);
    expect(a!.pct).toBeCloseTo(10, 1);
  });

  it("detects downside anomalies with negative z and pct", () => {
    const a = detectAnomaly(withSpark(spark(-0.031)));
    expect(a).not.toBeNull();
    expect(a!.zScore).toBeLessThanOrEqual(-2);
    expect(a!.pct).toBeLessThan(0);
  });

  it("returns null for short series", () => {
    expect(detectAnomaly(withSpark([100, 101, 100, 110]))).toBeNull(); // < 8 pts
    expect(detectAnomaly(ind("SPY"))).toBeNull(); // no sparkline at all
    expect(detectAnomaly(withSpark([]))).toBeNull();
  });

  it("returns null when the baseline has no variance (std ~ 0)", () => {
    expect(detectAnomaly(withSpark([100, 100, 100, 100, 100, 100, 100, 100, 110]))).toBeNull();
  });

  it("ignores non-positive points (log-returns undefined), nulling out thin data", () => {
    // enough points, but the zeros kill most return pairs -> < 6 usable rets
    expect(detectAnomaly(withSpark([100, 0, 0, 100, 101, 100, 101, 100, 130]))).toBeNull();
  });
});
