import { afterEach, describe, expect, it, vi } from "vitest";
import {
  changeLabels,
  deltaColor,
  formatClock,
  formatDelta,
  formatValue,
  relativeTime,
} from "../src/format";
import { ind } from "./helpers";

describe("formatValue", () => {
  it("gives FX-style unitless small numbers 4 decimals", () => {
    expect(formatValue(1.0855, "")).toBe("1.0855");
  });

  it("gives large unitless numbers commas and 2 decimals", () => {
    expect(formatValue(4521.5, "")).toBe("4,521.50");
  });

  it("prefixes dollars and suffixes percent / cents / thousands", () => {
    expect(formatValue(600.25, "$")).toBe("$600.25");
    expect(formatValue(4.25, "%")).toBe("4.25%");
    expect(formatValue(525, "¢")).toBe("525.00¢");
    expect(formatValue(159500, "k")).toBe("159,500.00k");
  });

  it("renders billions / millions of dollars", () => {
    expect(formatValue(23542.5, "bn$")).toBe("$23,542.50B");
    expect(formatValue(700000, "mn$")).toBe("$700,000.00M");
  });

  it("renders index-style units bare", () => {
    expect(formatValue(312.33, "idx")).toBe("312.33");
    expect(formatValue(5230.1, "pts")).toBe("5,230.10");
  });
});

describe("formatDelta", () => {
  it("returns null for a missing delta", () => {
    expect(formatDelta(null, "pct")).toBeNull();
  });

  it("formats bps deltas with sign from abs", () => {
    expect(formatDelta({ abs: 12.34, pct: null }, "bps")).toEqual({ text: "+12.3bps", sign: 1 });
    expect(formatDelta({ abs: -7.5, pct: null }, "bps")).toEqual({ text: "-7.5bps", sign: -1 });
    expect(formatDelta({ abs: 0, pct: null }, "bps")).toEqual({ text: "+0.0bps", sign: 0 });
  });

  it("formats pct deltas from the pct slot", () => {
    expect(formatDelta({ abs: 6, pct: 1.005 }, "pct")).toEqual({ text: "+1.00%", sign: 1 });
    expect(formatDelta({ abs: -6, pct: -1.2 }, "pct")).toEqual({ text: "-1.20%", sign: -1 });
  });

  it("falls back to the abs value when pct is null (e.g. claims counts)", () => {
    expect(formatDelta({ abs: -15000, pct: null }, "pct")).toEqual({ text: "-15,000", sign: -1 });
    expect(formatDelta({ abs: 15000, pct: null }, "pct")).toEqual({ text: "+15,000", sign: 1 });
  });
});

describe("deltaColor", () => {
  it("maps sign to the up/down/muted classes", () => {
    expect(deltaColor(1)).toBe("text-up");
    expect(deltaColor(-1)).toBe("text-down");
    expect(deltaColor(0)).toBe("text-chrome-muted");
  });
});

describe("changeLabels", () => {
  it("defaults to WoW / MoM / YTD", () => {
    expect(changeLabels(ind("SPY"))).toEqual({ wow: "WoW", mom: "MoM", ytd: "YTD" });
  });

  it("lets release indicators override individual slots", () => {
    const cpi = ind("CPIAUCSL", {
      meta: { changeLabels: { wow: "vs prior", ytd: "YoY" } },
    });
    expect(changeLabels(cpi)).toEqual({ wow: "vs prior", mom: "MoM", ytd: "YoY" });
  });
});

describe("relativeTime / formatClock", () => {
  afterEach(() => vi.useRealTimers());

  it("buckets ages into just now / minutes / hours / days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-09T12:00:00Z"));
    expect(relativeTime("2026-06-09T11:59:45Z")).toBe("just now");
    expect(relativeTime("2026-06-09T11:55:00Z")).toBe("5m ago");
    expect(relativeTime("2026-06-09T09:00:00Z")).toBe("3h ago");
    expect(relativeTime("2026-06-07T12:00:00Z")).toBe("2d ago");
  });

  it("is defensive about null / unparseable timestamps", () => {
    expect(relativeTime(null)).toBe("");
    expect(relativeTime("not-a-date")).toBe("");
    expect(formatClock(null)).toBe("—");
    expect(formatClock("garbage")).toBe("—");
  });

  it("formats a wall clock as hh:mm:ss", () => {
    expect(formatClock("2026-06-09T12:34:56Z")).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});
