// Date helpers for the release-calendar strip in ChartModal. Pure functions of
// an ISO day string, so rendering never reads the clock.

// ISO date `days` after `iso` (negative = before). UTC days are always 24h.
export function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86400_000).toISOString().slice(0, 10);
}

// Window around `today`: 90d back + 60d forward — wide enough to catch the
// surrounding pair of releases.
export function releaseWindow(today: string): { from: string; to: string } {
  return { from: addDaysIso(today, -90), to: addDaysIso(today, 60) };
}
