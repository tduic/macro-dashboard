import { useMemo } from "react";
import { buildRegime, regimeBias, type RegimeFlag } from "../regime";
import type { Indicator } from "../types";

function toneClass(tone: RegimeFlag["tone"]): string {
  if (tone === "up") return "text-up border-up/40 bg-up/10";
  if (tone === "down") return "text-down border-down/40 bg-down/10";
  return "text-chrome-muted border-chrome-border bg-chrome-card";
}

function biasClass(score: number): string {
  if (score >= 1) return "text-up";
  if (score <= -1) return "text-down";
  return "text-chrome-muted";
}

export function RegimeStrip({ indicators }: { indicators: Indicator[] }) {
  const flags = useMemo(() => buildRegime(indicators), [indicators]);
  const bias = useMemo(() => regimeBias(flags), [flags]);
  if (flags.length === 0) return null;

  return (
    <section
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-chrome-border bg-chrome-panel px-3 py-2"
      aria-label="Macro regime read"
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-chrome-muted">
          Regime
        </span>
        <span
          className={`font-mono text-sm font-semibold tracking-tight ${biasClass(bias.score)}`}
          title={`net bias score ${bias.score >= 0 ? "+" : ""}${bias.score}`}
        >
          {bias.label}
        </span>
        <span className="text-chrome-border">·</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {flags.map((f) => (
          <span
            key={f.axis}
            title={f.detail}
            className={`rounded border px-2 py-0.5 font-mono text-[11px] ${toneClass(f.tone)}`}
          >
            {f.label}
          </span>
        ))}
      </div>
    </section>
  );
}
