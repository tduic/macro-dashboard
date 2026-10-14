import type {
  CalendarResponse,
  EventsResponse,
  HistoryResponse,
  IndicatorsResponse,
  MetaResponse,
  NewsResponse,
  RangeKey,
  SnapshotMeta,
  UstCurveResponse,
} from "./types";

// Two data sources behind one interface:
//   live      the FastAPI backend under /api/* (local dev, `make dev`)
//   snapshot  static JSON written at build time by backend/snapshot.py into
//             <base>/snapshot/ (the public, serverless build:
//             VITE_DATA_MODE=snapshot, `npm run build:static`)
// Components only ever call `api.*`, so they don't know which one they got.

export type DataMode = "live" | "snapshot";

export const DATA_MODE: DataMode =
  import.meta.env.VITE_DATA_MODE === "snapshot" ? "snapshot" : "live";
export const IS_SNAPSHOT = DATA_MODE === "snapshot";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface Api {
  meta: () => Promise<MetaResponse>;
  indicators: () => Promise<IndicatorsResponse>;
  history: (id: string, range: RangeKey) => Promise<HistoryResponse>;
  news: () => Promise<NewsResponse>;
  calendar: () => Promise<CalendarResponse>;
  events: (from: string, to: string) => Promise<EventsResponse>;
  ustCurve: () => Promise<UstCurveResponse>;
  refresh: () => Promise<void>;
  /** Build-time snapshot metadata; null in live mode. */
  snapshotMeta: () => Promise<SnapshotMeta | null>;
}

async function getJSON<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function localIsoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

const defaultFetch: FetchLike = (u, i) => fetch(u, i);

export function createLiveApi(fetchImpl: FetchLike = defaultFetch): Api {
  const get = <T,>(url: string) => getJSON<T>(fetchImpl, url);
  return {
    meta: () => get<MetaResponse>("/api/meta"),
    indicators: () => get<IndicatorsResponse>("/api/indicators"),
    history: (id, range) =>
      get<HistoryResponse>(`/api/indicators/${encodeURIComponent(id)}/history?range=${range}`),
    news: () => get<NewsResponse>("/api/news"),
    calendar: () => get<CalendarResponse>("/api/calendar"),
    events: (from, to) =>
      get<EventsResponse>(
        `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    ustCurve: () => get<UstCurveResponse>("/api/curves/ust"),
    refresh: async () => {
      await fetchImpl("/api/refresh", { method: "POST" });
    },
    snapshotMeta: async () => null,
  };
}

// Indicator ids are path segments in the snapshot; the exporter only writes
// plain tokens, so anything else can't exist and is never requested.
const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

export function createSnapshotApi(
  base: string = "/",
  fetchImpl: FetchLike = defaultFetch,
  today: () => string = () => localIsoDate(new Date()),
): Api {
  const root = `${base.endsWith("/") ? base : base + "/"}snapshot/`;
  // The files never change within a page load; keep one request per file.
  const memo = new Map<string, Promise<unknown>>();
  const file = <T,>(path: string): Promise<T> => {
    let p = memo.get(path) as Promise<T> | undefined;
    if (!p) {
      p = getJSON<T>(fetchImpl, root + path);
      memo.set(path, p);
      p.catch(() => memo.delete(path)); // a failed read may be retried
    }
    return p;
  };
  const snapshotMeta = () => file<SnapshotMeta>("meta.json");

  return {
    meta: async () => {
      const m = await snapshotMeta();
      return { fredEnabled: m.fredEnabled, categories: m.categories, lastRefreshed: m.generatedAt };
    },
    indicators: () => file<IndicatorsResponse>("indicators.json"),
    history: async (id, range) => {
      const m = await snapshotMeta();
      // Not in the snapshot -> an empty series ("no data for this range"),
      // not a failed request.
      if (!SAFE_ID.test(id) || !m.history[id]?.includes(range)) {
        return { id, range, points: [] };
      }
      return file<HistoryResponse>(`history/${id}/${range}.json`);
    },
    news: () => file<NewsResponse>("news.json"),
    calendar: async () => {
      // "Upcoming" was relative to the build; drop releases that have since
      // passed for the viewer.
      const c = await file<CalendarResponse>("calendar.json");
      if (!c.enabled) return c;
      const t = today();
      const items = c.items.filter((i) => i.releaseDate >= t);
      return { ...c, count: items.length, items };
    },
    // One wide events file covers every chart range; filter the way the
    // /api/events route does.
    events: async (from, to) => {
      const all = await file<EventsResponse>("events.json");
      const events = all.events.filter((e) => e.date >= from && e.date <= to);
      return { from, to, count: events.length, events };
    },
    ustCurve: () => file<UstCurveResponse>("curves-ust.json"),
    refresh: async () => {}, // nothing to refresh: the data is fixed at build time
    snapshotMeta,
  };
}

export const api: Api = IS_SNAPSHOT
  ? createSnapshotApi(import.meta.env.BASE_URL)
  : createLiveApi();
