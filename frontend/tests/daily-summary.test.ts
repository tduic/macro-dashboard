import { describe, expect, it } from "vitest";
import { buildTopMovers, summarizeMovers, type MoverItem } from "../src/daily-summary";
import { ind, newsItem, withWowBps } from "./helpers";

const withSpark = (id: string, spark: number[], label = id) =>
  ind(id, { sparkline: spark, label });

describe("buildTopMovers", () => {
  it("ranks by absolute 1-day % move from the sparkline", () => {
    const movers = buildTopMovers(
      [
        withSpark("SPY", [100, 100.5]),   // +0.5%
        withSpark("WTI", [100, 97]),      // -3%
        withSpark("GOLD", [100, 101.8]),  // +1.8%
      ],
      [],
    );
    expect(movers.map((m) => m.ind.id)).toEqual(["WTI", "GOLD", "SPY"]);
    expect(movers[0].pct).toBeCloseTo(-3, 5);
    expect(movers[1].pct).toBeCloseTo(1.8, 5);
  });

  it("limits to k movers", () => {
    const inds = [
      withSpark("A", [100, 105]),
      withSpark("B", [100, 104]),
      withSpark("C", [100, 103]),
      withSpark("D", [100, 102]),
    ];
    expect(buildTopMovers(inds, [], 2).map((m) => m.ind.id)).toEqual(["A", "B"]);
  });

  it("excludes bps-type series — yield moves aren't comparable as %", () => {
    const tenY = withWowBps("DGS10", 12, { sparkline: [4.0, 5.0] }); // huge "move"
    const movers = buildTopMovers([tenY, withSpark("SPY", [100, 100.1])], []);
    expect(movers.map((m) => m.ind.id)).toEqual(["SPY"]);
  });

  it("excludes series with missing or too-short sparklines and zero baselines", () => {
    const movers = buildTopMovers(
      [
        ind("NOSPARK"),
        withSpark("SHORT", [100]),
        withSpark("ZEROBASE", [0, 50]),
        withSpark("OK", [100, 101]),
      ],
      [],
    );
    expect(movers.map((m) => m.ind.id)).toEqual(["OK"]);
  });

  it("attaches the first (most recent) matching driver headline via indicator keywords", () => {
    const news = [
      newsItem("Stocks drift sideways"),
      newsItem("Oil tumbles as OPEC boosts output"),     // matches WTI ("oil", "opec")
      newsItem("Crude oil rig counts fall"),              // older match — must not win
    ];
    const [wti] = buildTopMovers([withSpark("WTI", [100, 96])], news);
    expect(wti.driver?.title).toBe("Oil tumbles as OPEC boosts output");
  });

  it("leaves driver undefined when nothing matches or the id has no keywords", () => {
    const news = [newsItem("Totally unrelated headline")];
    const [wti] = buildTopMovers([withSpark("WTI", [100, 96])], news);
    expect(wti.driver).toBeUndefined();
    const [mystery] = buildTopMovers([withSpark("ZZZ", [100, 96])], news);
    expect(mystery.driver).toBeUndefined();
  });
});

describe("summarizeMovers", () => {
  const mover = (over: Partial<MoverItem> & Pick<MoverItem, "ind" | "pct">): MoverItem => over;

  it("returns empty string for no movers", () => {
    expect(summarizeMovers([])).toBe("");
  });

  it("joins movers with signed percents and trims the label at ' ('", () => {
    const s = summarizeMovers([
      mover({ ind: ind("WTI", { label: "WTI Crude (CL=F)" }), pct: -3.2 }),
      mover({ ind: ind("GOLD", { label: "Gold" }), pct: 1.8 }),
    ]);
    expect(s).toBe("WTI Crude -3.2% · Gold +1.8%");
  });

  it("appends the driver headline, truncating beyond 70 chars", () => {
    const long = "x".repeat(80);
    const s = summarizeMovers([
      mover({ ind: ind("WTI", { label: "WTI" }), pct: -3.2, driver: newsItem(long) }),
    ]);
    expect(s).toBe(`WTI -3.2% (${"x".repeat(67)}…)`);
    const short = summarizeMovers([
      mover({ ind: ind("WTI", { label: "WTI" }), pct: 2.0, driver: newsItem("OPEC cuts") }),
    ]);
    expect(short).toBe("WTI +2.0% (OPEC cuts)");
  });
});
