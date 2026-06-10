import { describe, expect, it } from "vitest";
import { buildRegime, regimeBias, type RegimeFlag } from "../src/regime";
import { ind, withWow, withWowBps } from "./helpers";

function flag(flags: RegimeFlag[], axis: string): RegimeFlag | undefined {
  return flags.find((f) => f.axis === axis);
}

describe("buildRegime", () => {
  it("returns no flags for empty input", () => {
    expect(buildRegime([])).toEqual([]);
  });

  it("skips indicators whose WoW change is missing", () => {
    expect(buildRegime([ind("GSPC")])).toEqual([]);
  });

  it("classifies equities: risk-on / risk-off / flat", () => {
    expect(flag(buildRegime([withWow("GSPC", 1.2)]), "Risk"))
      .toMatchObject({ label: "Risk-On", tone: "up" });
    expect(flag(buildRegime([withWow("GSPC", -1.2)]), "Risk"))
      .toMatchObject({ label: "Risk-Off", tone: "down" });
    expect(flag(buildRegime([withWow("GSPC", 0.1)]), "Risk"))
      .toMatchObject({ label: "Flat", tone: "neutral" });
  });

  it("falls back to SPY when GSPC is absent", () => {
    const f = flag(buildRegime([withWow("SPY", 0.8)]), "Risk");
    expect(f).toMatchObject({ label: "Risk-On", tone: "up" });
  });

  it("vol: rising VIX is risk-off (tone down), falling is tone up", () => {
    expect(flag(buildRegime([withWow("VIX", 8, { value: 22.5 })]), "Vol"))
      .toMatchObject({ label: "Vol bid", tone: "down" });
    expect(flag(buildRegime([withWow("VIX", -8, { value: 14.1 })]), "Vol"))
      .toMatchObject({ label: "Vol offered", tone: "up" });
    expect(flag(buildRegime([withWow("VIX", 1, { value: 16 })]), "Vol"))
      .toMatchObject({ label: "Vol stable", tone: "neutral" });
  });

  it("dollar: stronger DXY is tone down (risk-off)", () => {
    expect(flag(buildRegime([withWow("DXY", 0.5)]), "Dollar"))
      .toMatchObject({ label: "Dollar bid", tone: "down" });
    expect(flag(buildRegime([withWow("DXY", -0.5)]), "Dollar"))
      .toMatchObject({ label: "Dollar offered", tone: "up" });
    expect(flag(buildRegime([withWow("DXY", 0.0)]), "Dollar"))
      .toMatchObject({ label: "Dollar flat", tone: "neutral" });
  });

  it("yields: uses the bps abs slot, ±5bps threshold", () => {
    const up = flag(buildRegime([withWowBps("DGS10", 7.5, { value: 4.42 })]), "Yields");
    expect(up).toMatchObject({ label: "Yields up", tone: "down" });
    expect(up!.detail).toBe("10Y +7.5bps WoW (lvl 4.42%)");
    expect(flag(buildRegime([withWowBps("DGS10", -7.5, { value: 4.2 })]), "Yields"))
      .toMatchObject({ label: "Yields down", tone: "up" });
    expect(flag(buildRegime([withWowBps("DGS10", 3, { value: 4.3 })]), "Yields"))
      .toMatchObject({ label: "Yields flat", tone: "neutral" });
  });

  it("curve: positive 2s10s reads steep, negative reads inverted (from the level)", () => {
    const steep = flag(buildRegime([ind("T10Y2Y", { value: 0.42 })]), "Curve");
    expect(steep).toMatchObject({ label: "Curve +42bps", tone: "up", detail: "2s10s 42bps" });
    const inv = flag(buildRegime([ind("T10Y2Y", { value: -0.15 })]), "Curve");
    expect(inv).toMatchObject({ label: "Inverted -15bps", tone: "down" });
  });

  it("crude and gold use a ±1.5% threshold and bid = tone up", () => {
    expect(flag(buildRegime([withWow("WTI", 2.0)]), "Crude"))
      .toMatchObject({ label: "Crude bid", tone: "up" });
    expect(flag(buildRegime([withWow("WTI", -2.0)]), "Crude"))
      .toMatchObject({ label: "Crude offered", tone: "down" });
    expect(flag(buildRegime([withWow("GOLD", 2.0)]), "Gold"))
      .toMatchObject({ label: "Gold bid", tone: "up" });
    expect(flag(buildRegime([withWow("GOLD", 1.0)]), "Gold"))
      .toMatchObject({ label: "Gold flat", tone: "neutral" });
  });

  it("derives one flag per axis from a full board", () => {
    const flags = buildRegime([
      withWow("GSPC", 1.0),
      withWow("VIX", -6, { value: 13 }),
      withWow("DXY", -0.4),
      withWowBps("DGS10", -8, { value: 4.1 }),
      ind("T10Y2Y", { value: 0.3 }),
      withWow("WTI", 0.2),
      withWow("GOLD", 1.9),
    ]);
    expect(flags.map((f) => f.axis)).toEqual(
      ["Risk", "Vol", "Dollar", "Yields", "Curve", "Crude", "Gold"],
    );
  });
});

describe("regimeBias", () => {
  const f = (tone: "up" | "down" | "neutral"): RegimeFlag =>
    ({ axis: "x", label: "x", tone, detail: "" });

  it("scores up minus down and labels the lean", () => {
    expect(regimeBias([f("up"), f("up"), f("up")])).toEqual({ score: 3, label: "Risk-On" });
    expect(regimeBias([f("up"), f("neutral")])).toEqual({ score: 1, label: "Leaning Risk-On" });
    expect(regimeBias([f("up"), f("down")])).toEqual({ score: 0, label: "Mixed" });
    expect(regimeBias([f("down"), f("neutral")])).toEqual({ score: -1, label: "Leaning Risk-Off" });
    expect(regimeBias([f("down"), f("down"), f("down"), f("up")]))
      .toEqual({ score: -2, label: "Leaning Risk-Off" });
    expect(regimeBias([f("down"), f("down"), f("down")])).toEqual({ score: -3, label: "Risk-Off" });
    expect(regimeBias([])).toEqual({ score: 0, label: "Mixed" });
  });
});
