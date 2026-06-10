import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshness } from "../src/staleness";
import { ind } from "./helpers";

// Pin "now" so calendar-day ages are deterministic.
const NOW = new Date("2026-06-09T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const daily = (asOf: string, category = "Equities") => ind("SPY", { asOf, category });

describe("freshness — daily-cadence categories", () => {
  it("same-day and 1-day-old prints are fresh", () => {
    expect(freshness(daily("2026-06-09"))).toEqual({ state: "fresh", ageDays: 0 });
    expect(freshness(daily("2026-06-08"))).toEqual({ state: "fresh", ageDays: 1 });
  });

  it("2–4 day gaps get weekend tolerance", () => {
    expect(freshness(daily("2026-06-07"))).toEqual({ state: "weekend", ageDays: 2 });
    expect(freshness(daily("2026-06-05"))).toEqual({ state: "weekend", ageDays: 4 });
  });

  it("older than 4 days is stale", () => {
    expect(freshness(daily("2026-06-04"))).toEqual({ state: "stale", ageDays: 5 });
    expect(freshness(daily("2026-05-01")).state).toBe("stale");
  });

  it.each(["Rates", "FX", "Credit", "Global Equities", "Energy & Metals", "Ags / Softs", "Ratios"])(
    "%s follows the daily windows",
    (category) => {
      expect(freshness(daily("2026-06-07", category)).state).toBe("weekend");
    },
  );
});

describe("freshness — crypto (24/7, no weekend tolerance)", () => {
  it("1 day old is still fresh", () => {
    expect(freshness(daily("2026-06-08", "Crypto"))).toEqual({ state: "fresh", ageDays: 1 });
  });

  it("2 days old is already stale (no weekend window)", () => {
    expect(freshness(daily("2026-06-07", "Crypto"))).toEqual({ state: "stale", ageDays: 2 });
  });
});

describe("freshness — monthly releases (Economic Data)", () => {
  const monthly = (asOf: string) => ind("CPIAUCSL", { asOf, category: "Economic Data" });

  it("within ~40 days is fresh", () => {
    expect(freshness(monthly("2026-05-15"))).toEqual({ state: "fresh", ageDays: 25 });
    expect(freshness(monthly("2026-04-30"))).toEqual({ state: "fresh", ageDays: 40 });
  });

  it("41–75 days is the in-between (weekend) state", () => {
    expect(freshness(monthly("2026-04-29"))).toEqual({ state: "weekend", ageDays: 41 });
    expect(freshness(monthly("2026-03-26"))).toEqual({ state: "weekend", ageDays: 75 });
  });

  it("older than 75 days is stale", () => {
    expect(freshness(monthly("2026-03-25"))).toEqual({ state: "stale", ageDays: 76 });
    expect(freshness(monthly("2025-12-01")).state).toBe("stale");
  });
});
