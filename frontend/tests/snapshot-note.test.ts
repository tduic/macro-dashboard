import { describe, expect, it } from "vitest";
import { formatAge, formatUtc, snapshotNote } from "../src/snapshot-note";
import type { SnapshotMeta } from "../src/types";

const GEN = "2026-06-05T21:07:00+00:00";
const T = Date.parse(GEN);

function meta(over: Partial<SnapshotMeta> = {}): SnapshotMeta {
  return {
    format: 1,
    generatedAt: GEN,
    source: "live",
    fredEnabled: true,
    categories: [],
    lastRefreshed: GEN,
    indicatorCount: 1,
    newsCount: 0,
    ranges: [],
    history: {},
    eventsWindow: { from: "2021-01-01", to: "2026-12-01" },
    ...over,
  };
}

describe("formatUtc", () => {
  it("renders in UTC regardless of the viewer's zone", () => {
    expect(formatUtc(GEN)).toBe("Jun 5, 2026, 21:07 UTC");
  });
  it("passes through junk", () => {
    expect(formatUtc("nope")).toBe("nope");
  });
});

describe("formatAge", () => {
  it.each([
    [0, "just now"],
    [-5 * 60_000, "just now"], // clock skew never shows a negative age
    [59 * 60_000, "59m ago"],
    [3 * 3600_000, "3h ago"],
    [47 * 3600_000, "47h ago"],
    [3 * 86400_000, "3d ago"],
  ])("%d ms later -> %s", (dt, want) => {
    expect(formatAge(GEN, T + dt)).toBe(want);
  });
  it("is null for an unparseable stamp", () => {
    expect(formatAge("nope", T)).toBeNull();
  });
});

describe("snapshotNote", () => {
  it("says when a live snapshot was taken and that it is not live", () => {
    const n = snapshotNote(meta(), T + 2 * 3600_000);
    expect(n.tone).toBe("info");
    expect(n.text).toBe("Static snapshot · data as of Jun 5, 2026, 21:07 UTC (2h ago) · not live");
    expect(n.detail).toMatch(/no server/);
  });
  it("labels fixture data as not market data", () => {
    const n = snapshotNote(meta({ source: "fixture" }), T);
    expect(n.tone).toBe("fixture");
    expect(n.text).toMatch(/^Test fixture data, not market data/);
  });
});
