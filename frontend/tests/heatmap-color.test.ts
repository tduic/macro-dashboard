import { describe, expect, it } from "vitest";
import { heatmapColor } from "../src/heatmap-color";

describe("heatmapColor", () => {
  it("renders a neutral cell for missing values", () => {
    const neutral = "rgba(31, 39, 51, 0.35)";
    expect(heatmapColor(null)).toBe(neutral);
    expect(heatmapColor(undefined)).toBe(neutral);
    expect(heatmapColor(Number.NaN)).toBe(neutral);
  });

  it("zero sits at the floor alpha on the positive palette", () => {
    expect(heatmapColor(0)).toBe("rgba(38, 208, 124, 0.08)");
  });

  it("uses green for gains and red for losses", () => {
    expect(heatmapColor(4)).toMatch(/^rgba\(38, 208, 124, /);
    expect(heatmapColor(-4)).toMatch(/^rgba\(255, 92, 92, /);
  });

  it("is symmetric: equal magnitude moves get equal alpha", () => {
    const alpha = (c: string) => c.match(/([\d.]+)\)$/)![1];
    expect(alpha(heatmapColor(4))).toBe(alpha(heatmapColor(-4)));
    expect(heatmapColor(4)).toBe("rgba(38, 208, 124, 0.26)"); // 0.08 + 0.4*0.45
  });

  it("saturates at ±10% and clamps anything beyond", () => {
    const maxPos = "rgba(38, 208, 124, 0.53)"; // 0.08 + 0.45
    const maxNeg = "rgba(255, 92, 92, 0.53)";
    expect(heatmapColor(10)).toBe(maxPos);
    expect(heatmapColor(25)).toBe(maxPos);
    expect(heatmapColor(-10)).toBe(maxNeg);
    expect(heatmapColor(-99)).toBe(maxNeg);
  });

  it("alpha grows monotonically with the magnitude of the move", () => {
    const alpha = (p: number) => Number(heatmapColor(p).match(/([\d.]+)\)$/)![1]);
    expect(alpha(1)).toBeLessThan(alpha(5));
    expect(alpha(5)).toBeLessThan(alpha(10));
  });
});
