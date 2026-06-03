// Synthesizes a 1-line macro "regime read" from the already-loaded indicators.
// Each flag is a coherent macro interpretation: tone "up" = generally risk-on,
// "down" = risk-off, "neutral" = flat. Mixed colors visualize regime divergence.

import type { Indicator } from "./types";

export type Tone = "up" | "down" | "neutral";

export interface RegimeFlag {
  axis: string;      // short axis name (Risk, Vol, Yields, ...)
  label: string;     // human-readable read e.g. "Risk-On", "Yields down"
  tone: Tone;        // for color
  detail: string;    // tooltip / underlying number
}

function findOne(indicators: Indicator[], ids: string[]): Indicator | undefined {
  for (const id of ids) {
    const i = indicators.find((x) => x.id === id);
    if (i) return i;
  }
  return undefined;
}

function wowPct(i: Indicator | undefined): number | null {
  const d = i?.change?.wow;
  if (!d) return null;
  // For yields (bps), pct is null; recover ~percent from bps so we can use a
  // common threshold path below.
  if (d.pct != null) return d.pct;
  return null;
}

function wowAbs(i: Indicator | undefined): number | null {
  return i?.change?.wow?.abs ?? null;
}

export function buildRegime(indicators: Indicator[]): RegimeFlag[] {
  const flags: RegimeFlag[] = [];

  // --- Risk / equities ---
  const eq = findOne(indicators, ["GSPC", "SPY"]);
  const eqPct = wowPct(eq);
  if (eq && eqPct != null) {
    const detail = `S&P ${eqPct >= 0 ? "+" : ""}${eqPct.toFixed(2)}% WoW`;
    flags.push(
      eqPct > 0.3
        ? { axis: "Risk", label: "Risk-On", tone: "up", detail }
        : eqPct < -0.3
          ? { axis: "Risk", label: "Risk-Off", tone: "down", detail }
          : { axis: "Risk", label: "Flat", tone: "neutral", detail },
    );
  }

  // --- Vol ---
  const vix = findOne(indicators, ["VIX"]);
  const vixPct = wowPct(vix);
  if (vix && vixPct != null) {
    const detail = `VIX ${vixPct >= 0 ? "+" : ""}${vixPct.toFixed(1)}% WoW (lvl ${vix.value.toFixed(1)})`;
    flags.push(
      vixPct > 5
        ? { axis: "Vol", label: "Vol bid", tone: "down", detail }
        : vixPct < -5
          ? { axis: "Vol", label: "Vol offered", tone: "up", detail }
          : { axis: "Vol", label: "Vol stable", tone: "neutral", detail },
    );
  }

  // --- Dollar ---
  const dxy = findOne(indicators, ["DXY"]);
  const dxyPct = wowPct(dxy);
  if (dxy && dxyPct != null) {
    const detail = `DXY ${dxyPct >= 0 ? "+" : ""}${dxyPct.toFixed(2)}% WoW`;
    flags.push(
      dxyPct > 0.3
        ? { axis: "Dollar", label: "Dollar bid", tone: "down", detail }
        : dxyPct < -0.3
          ? { axis: "Dollar", label: "Dollar offered", tone: "up", detail }
          : { axis: "Dollar", label: "Dollar flat", tone: "neutral", detail },
    );
  }

  // --- Yields (10Y) — changeType is "bps", so abs is the bps move ---
  const tenY = findOne(indicators, ["DGS10"]);
  const tenYbps = wowAbs(tenY);
  if (tenY && tenYbps != null) {
    const detail = `10Y ${tenYbps >= 0 ? "+" : ""}${tenYbps.toFixed(1)}bps WoW (lvl ${tenY.value.toFixed(2)}%)`;
    flags.push(
      tenYbps > 5
        ? { axis: "Yields", label: "Yields up", tone: "down", detail }
        : tenYbps < -5
          ? { axis: "Yields", label: "Yields down", tone: "up", detail }
          : { axis: "Yields", label: "Yields flat", tone: "neutral", detail },
    );
  }

  // --- Curve (2s10s level) — value is in percent, so e.g. 0.42 = 42bps steep ---
  const curve = findOne(indicators, ["T10Y2Y"]);
  if (curve) {
    const bps = Math.round(curve.value * 100);
    flags.push(
      bps > 0
        ? { axis: "Curve", label: `Curve +${bps}bps`, tone: "up", detail: `2s10s ${bps}bps` }
        : { axis: "Curve", label: `Inverted ${bps}bps`, tone: "down", detail: `2s10s ${bps}bps` },
    );
  }

  // --- Crude (WTI) ---
  const wti = findOne(indicators, ["WTI"]);
  const wtiPct = wowPct(wti);
  if (wti && wtiPct != null) {
    const detail = `WTI ${wtiPct >= 0 ? "+" : ""}${wtiPct.toFixed(2)}% WoW`;
    flags.push(
      wtiPct > 1.5
        ? { axis: "Crude", label: "Crude bid", tone: "up", detail }
        : wtiPct < -1.5
          ? { axis: "Crude", label: "Crude offered", tone: "down", detail }
          : { axis: "Crude", label: "Crude flat", tone: "neutral", detail },
    );
  }

  // --- Gold ---
  const gold = findOne(indicators, ["GOLD"]);
  const goldPct = wowPct(gold);
  if (gold && goldPct != null) {
    const detail = `Gold ${goldPct >= 0 ? "+" : ""}${goldPct.toFixed(2)}% WoW`;
    flags.push(
      goldPct > 1.5
        ? { axis: "Gold", label: "Gold bid", tone: "up", detail }
        : goldPct < -1.5
          ? { axis: "Gold", label: "Gold offered", tone: "down", detail }
          : { axis: "Gold", label: "Gold flat", tone: "neutral", detail },
    );
  }

  return flags;
}

// Net bias score: count of "up" tones minus "down" tones. Used for a top-level
// "leaning" badge.
export function regimeBias(flags: RegimeFlag[]): { score: number; label: string } {
  let s = 0;
  for (const f of flags) {
    if (f.tone === "up") s += 1;
    else if (f.tone === "down") s -= 1;
  }
  let label = "Mixed";
  if (s >= 3) label = "Risk-On";
  else if (s >= 1) label = "Leaning Risk-On";
  else if (s <= -3) label = "Risk-Off";
  else if (s <= -1) label = "Leaning Risk-Off";
  return { score: s, label };
}
