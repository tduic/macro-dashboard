import { describe, expect, it } from "vitest";
import { findRelatedNews, getIndicatorKeywords } from "../src/indicator-keywords";
import { getEventTypeForIndicator, INDICATOR_EVENT_TYPE } from "../src/indicator-events";

describe("getIndicatorKeywords", () => {
  it("spot-checks key mappings", () => {
    expect(getIndicatorKeywords("SPY")).toContain("s&p");
    expect(getIndicatorKeywords("GSPC")).toEqual(getIndicatorKeywords("SPY")); // ETF/index pair
    expect(getIndicatorKeywords("WTI")).toEqual(expect.arrayContaining(["oil", "crude", "opec"]));
    expect(getIndicatorKeywords("DFF")).toContain("fomc");
    expect(getIndicatorKeywords("PAYEMS")).toContain("nonfarm");
    expect(getIndicatorKeywords("BTC")).toContain("bitcoin");
  });

  it("returns an empty list for unmapped ids", () => {
    expect(getIndicatorKeywords("NOT_A_THING")).toEqual([]);
  });
});

describe("findRelatedNews", () => {
  const items = [
    { title: "OPEC surprises with output cut" },
    { title: "Gold steadies after rally" },
    { title: "Crude inventories build" },
  ];

  it("filters case-insensitively on any keyword", () => {
    const hits = findRelatedNews(items, "WTI");
    expect(hits.map((h) => h.title)).toEqual([
      "OPEC surprises with output cut",
      "Crude inventories build",
    ]);
  });

  it("returns nothing for ids without keywords", () => {
    expect(findRelatedNews(items, "UNKNOWN")).toEqual([]);
  });
});

describe("indicator -> event-type mapping", () => {
  it("routes each release series to its anchoring macro event", () => {
    expect(getEventTypeForIndicator("CPIAUCSL")).toBe("CPI");
    expect(getEventTypeForIndicator("CPILFESL")).toBe("CPI");
    expect(getEventTypeForIndicator("PCEPILFE")).toBe("PCE");
    expect(getEventTypeForIndicator("PAYEMS")).toBe("NFP");
    expect(getEventTypeForIndicator("UNRATE")).toBe("NFP");
    expect(getEventTypeForIndicator("GDPC1")).toBe("GDP");
    expect(getEventTypeForIndicator("RSAFS")).toBe("RETAIL");
    expect(getEventTypeForIndicator("PPIACO")).toBe("PPI");
    expect(getEventTypeForIndicator("DFF")).toBe("FOMC");
  });

  it("returns undefined for market series without release anchors", () => {
    expect(getEventTypeForIndicator("SPY")).toBeUndefined();
  });

  it("only emits event types the backend produces", () => {
    const backendTypes = new Set(["FOMC", "NFP", "CPI", "PPI", "RETAIL", "PCE", "GDP"]);
    for (const t of Object.values(INDICATOR_EVENT_TYPE)) {
      expect(backendTypes.has(t)).toBe(true);
    }
  });
});
