import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function CalendarPanel({ fredEnabled }: { fredEnabled: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["calendar"],
    queryFn: api.calendar,
    enabled: fredEnabled,
    staleTime: 6 * 60 * 60_000,
  });

  if (!fredEnabled) return null;

  const items = data?.items ?? [];

  return (
    <section className="rounded-lg border border-chrome-border bg-chrome-panel">
      <div className="flex items-center justify-between border-b border-chrome-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-chrome-text">
          Economic Calendar · next 14d
        </h2>
        <span className="font-mono text-[10px] text-chrome-muted">{items.length}</span>
      </div>
      {isLoading ? (
        <div className="p-3 text-sm text-chrome-muted">loading…</div>
      ) : items.length === 0 ? (
        <div className="p-3 text-sm text-chrome-muted">no upcoming releases</div>
      ) : (
        <ul className="flex flex-wrap gap-2 p-3">
          {items.map((it, i) => (
            <li
              key={`${it.name}-${it.releaseDate}-${i}`}
              className="flex min-w-[140px] flex-col rounded border border-chrome-border bg-chrome-card px-2.5 py-1.5"
            >
              <span className="font-mono text-[11px] text-up">{fmtDate(it.releaseDate)}</span>
              <span className="text-xs text-chrome-text">{it.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
