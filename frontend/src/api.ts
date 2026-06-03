import type {
  CalendarResponse,
  EventsResponse,
  HistoryResponse,
  IndicatorsResponse,
  MetaResponse,
  NewsResponse,
  RangeKey,
} from "./types";

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const api = {
  meta: () => getJSON<MetaResponse>("/api/meta"),
  indicators: () => getJSON<IndicatorsResponse>("/api/indicators"),
  history: (id: string, range: RangeKey) =>
    getJSON<HistoryResponse>(`/api/indicators/${encodeURIComponent(id)}/history?range=${range}`),
  news: () => getJSON<NewsResponse>("/api/news"),
  calendar: () => getJSON<CalendarResponse>("/api/calendar"),
  events: (from: string, to: string) =>
    getJSON<EventsResponse>(
      `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  refresh: async () => {
    await fetch("/api/refresh", { method: "POST" });
  },
};
