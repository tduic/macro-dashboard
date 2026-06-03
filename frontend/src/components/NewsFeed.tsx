import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { relativeTime } from "../format";
import { TOPICS, type Topic } from "../topics";
import type { NewsItem } from "../types";

const ALL = "All" as const;
type Filter = typeof ALL | Topic;

export function NewsFeed() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["news"],
    queryFn: api.news,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  const [filter, setFilter] = useState<Filter>(ALL);

  const items: NewsItem[] = data?.items ?? [];

  // Per-topic counts for the tab badges. "All" = total.
  const counts = useMemo(() => {
    const c: Record<string, number> = { [ALL]: items.length };
    for (const t of TOPICS) c[t] = 0;
    for (const it of items) {
      for (const t of it.topics) {
        if (t in c) c[t] += 1;
      }
    }
    return c;
  }, [items]);

  const filtered =
    filter === ALL ? items : items.filter((i) => i.topics.includes(filter));

  return (
    <section className="flex h-full flex-col rounded-lg border border-chrome-border bg-chrome-panel">
      <div className="flex items-center justify-between border-b border-chrome-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-chrome-text">News</h2>
        <span className="font-mono text-[10px] text-chrome-muted">{filtered.length}</span>
      </div>

      {/* Topic tabs */}
      <div className="flex flex-wrap gap-1 border-b border-chrome-border px-3 py-2">
        <TopicTab label={ALL} active={filter === ALL} count={counts[ALL]} onClick={() => setFilter(ALL)} />
        {TOPICS.map((t) => (
          <TopicTab
            key={t}
            label={t}
            active={filter === t}
            count={counts[t] ?? 0}
            disabled={(counts[t] ?? 0) === 0}
            onClick={() => setFilter(t)}
          />
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-sm text-chrome-muted">loading news…</div>
        ) : isError ? (
          <div className="p-4 text-sm text-down">failed to load news</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-sm text-chrome-muted">no items for this topic</div>
        ) : (
          <ul className="divide-y divide-chrome-border">
            {filtered.map((it, idx) => (
              <NewsRow key={`${it.url}-${idx}`} item={it} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TopicTab({
  label,
  active,
  count,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] uppercase tracking-wide transition-colors ${
        active
          ? "bg-chrome-text text-chrome-bg"
          : disabled
            ? "border border-chrome-border/50 text-chrome-muted/40"
            : "border border-chrome-border text-chrome-muted hover:text-white"
      }`}
    >
      <span>{label}</span>
      <span className="font-mono text-[9px] opacity-70">{count}</span>
    </button>
  );
}

export function NewsRow({ item }: { item: NewsItem }) {
  return (
    <li className="px-3 py-2 hover:bg-chrome-card">
      <a href={item.url} target="_blank" rel="noopener noreferrer" className="block">
        <div className="text-xs leading-snug text-chrome-text hover:text-white">{item.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-chrome-muted">
          <span className="rounded bg-chrome-card px-1 py-0.5 text-[9px] uppercase tracking-wide">
            {item.source}
          </span>
          {item.topics.slice(0, 3).map((t) => (
            <span
              key={t}
              className="rounded border border-chrome-border px-1 py-0.5 text-[9px] uppercase tracking-wide"
            >
              {t}
            </span>
          ))}
          <span>·</span>
          <span>{relativeTime(item.publishedAt)}</span>
        </div>
      </a>
    </li>
  );
}
