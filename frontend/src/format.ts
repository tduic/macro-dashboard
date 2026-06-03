import type { Delta, Indicator } from "./types";

export function formatValue(v: number, unit: string): string {
  // FX crosses (no unit) want more precision; big prices want commas.
  const abs = Math.abs(v);
  let digits = 2;
  if (unit === "" ) digits = abs < 10 ? 4 : 2; // EURUSD etc
  else if (abs >= 1000) digits = 2;
  else if (abs < 10) digits = 2;

  const formatted = v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  if (unit === "$") return `$${formatted}`;
  if (unit === "%") return `${formatted}%`;
  if (unit === "¢") return `${formatted}¢`;
  if (unit === "pts" || unit === "idx") return formatted;
  if (unit === "k") return `${formatted}k`;
  if (unit === "bn$") return `$${formatted}B`;
  if (unit === "mn$") return `$${formatted}M`;
  return formatted;
}

// Render a delta for a card. For bps changeType show "+12.3bps".
export function formatDelta(
  d: Delta,
  changeType: "pct" | "bps",
): { text: string; sign: number } | null {
  if (!d) return null;
  if (changeType === "bps") {
    const sign = Math.sign(d.abs);
    const s = `${d.abs >= 0 ? "+" : ""}${d.abs.toFixed(1)}bps`;
    return { text: s, sign };
  }
  // pct
  if (d.pct === null || d.pct === undefined) {
    const sign = Math.sign(d.abs);
    return { text: `${d.abs >= 0 ? "+" : ""}${d.abs.toLocaleString()}`, sign };
  }
  const sign = Math.sign(d.pct);
  return { text: `${d.pct >= 0 ? "+" : ""}${d.pct.toFixed(2)}%`, sign };
}

export function deltaColor(sign: number): string {
  if (sign > 0) return "text-up";
  if (sign < 0) return "text-down";
  return "text-chrome-muted";
}

// Labels for the three change slots; releases override via meta.changeLabels.
export function changeLabels(ind: Indicator): { wow: string; mom: string; ytd: string } {
  const override = ind.meta?.changeLabels ?? {};
  return {
    wow: override.wow ?? "WoW",
    mom: override.mom ?? "MoM",
    ytd: override.ytd ?? "YTD",
  };
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function formatClock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
