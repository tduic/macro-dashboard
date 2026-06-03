import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { relativeTime } from "../format";

export function NewsFeed() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["news"],
    queryFn: api.news,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const [filter, setFilter] = useState<string>("All");

  const items = data?.items ?? [];
  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category));
    return ["All", ...Array.from(set).sort()];
  }, [items]);

  const filtered = filter === "All" ? items : items.filter((i) => i.category === filter);

  return (
    <section className="flex h-full flex-col rounded-lg border border-chrome-border bg-chrome-panel">
      <div className="flex items-center justify-between border-b border-chrome-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-chrome-text">News</h2>
        <span className="font-mono text-[10px] text-chrome-muted">{filtered.length}</span>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-chrome-border px-3 py-2">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
              c === filter
                ? "bg-chrome-text text-chrome-bg"
                : "border border-chrome-border text-chrome-muted hover:text-white"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-sm text-chrome-muted">loading news…</div>
        ) : isError ? (
          <div className="p-4 text-sm text-down">failed to load news</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-chrome-muted">no items</div>
        ) : (
          <ul className="divide-y divide-chrome-border">
            {filtered.map((it, idx) => (
              <li key={`${it.url}-${idx}`} className="px-3 py-2 hover:bg-chrome-card">
                <a href={it.url} target="_blank" rel="noopener noreferrer" className="block">
                  <div className="text-xs leading-snug text-chrome-text hover:text-white">
                    {it.title}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-chrome-muted">
                    <span className="rounded bg-chrome-card px-1 py-0.5 text-[9px] uppercase tracking-wide">
                      {it.category}
                    </span>
                    <span>{it.source}</span>
                    <span>·</span>
                    <span>{relativeTime(it.publishedAt)}</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
