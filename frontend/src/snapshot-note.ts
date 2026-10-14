// Wording for the "data as of" strip shown in the static (snapshot) build.
// Pure: the clock is passed in so tests are deterministic.

import type { SnapshotMeta } from "./types";

export interface SnapshotNote {
  tone: "info" | "fixture";
  text: string;   // the visible one-liner
  detail: string; // tooltip / screen-reader detail
}

export function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const s = d.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${s} UTC`;
}

export function formatAge(iso: string, nowMs: number): string | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.floor((nowMs - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function snapshotNote(meta: SnapshotMeta, nowMs: number): SnapshotNote {
  const when = formatUtc(meta.generatedAt);
  const age = formatAge(meta.generatedAt, nowMs);
  const stamp = age ? `${when} (${age})` : when;
  if (meta.source === "fixture") {
    return {
      tone: "fixture",
      text: `Test fixture data, not market data · generated ${stamp}`,
      detail:
        "Every number here comes from the offline test fakes. The deployed build fetches real data when it is built.",
    };
  }
  return {
    tone: "info",
    text: `Static snapshot · data as of ${stamp} · not live`,
    detail:
      "This public build has no server. Prices, rates, news and charts were fetched once, when the site was last built, and do not update while you watch.",
  };
}
