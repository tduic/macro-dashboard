import { describe, expect, it } from "vitest";
import { addDaysIso, releaseWindow } from "../src/release-window";

describe("addDaysIso", () => {
  it("moves across month, year and leap-day boundaries", () => {
    expect(addDaysIso("2026-10-13", 0)).toBe("2026-10-13");
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("ignores local DST (UTC days are always 24h)", () => {
    expect(addDaysIso("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDaysIso("2026-11-02", -2)).toBe("2026-10-31");
  });
});

describe("releaseWindow", () => {
  it("spans 90 days back and 60 days forward", () => {
    expect(releaseWindow("2026-10-13")).toEqual({ from: "2026-07-15", to: "2026-12-12" });
  });

  it("matches the clock-based window the strip used to compute during render", () => {
    for (const t of [Date.UTC(2026, 9, 13, 0, 0, 1), Date.UTC(2026, 2, 8, 23, 59), Date.UTC(2028, 1, 29, 12)]) {
      const today = new Date(t).toISOString().slice(0, 10);
      expect(releaseWindow(today)).toEqual({
        from: new Date(t - 90 * 86400_000).toISOString().slice(0, 10),
        to: new Date(t + 60 * 86400_000).toISOString().slice(0, 10),
      });
    }
  });
});
