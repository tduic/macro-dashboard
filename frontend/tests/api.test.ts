import { describe, expect, it } from "vitest";
import { api, createLiveApi, createSnapshotApi, DATA_MODE, localIsoDate } from "../src/api";
import type { SnapshotMeta } from "../src/types";

const META: SnapshotMeta = {
  format: 1,
  generatedAt: "2026-06-05T21:00:00+00:00",
  source: "live",
  fredEnabled: true,
  categories: ["Equities", "Rates"],
  lastRefreshed: "2026-06-05T21:00:00+00:00",
  indicatorCount: 2,
  newsCount: 1,
  ranges: ["1W", "1M", "3M", "6M", "YTD", "1Y", "5Y"],
  history: { SPY: ["1Y", "5Y"], DGS10: ["1Y"] },
  eventsWindow: { from: "2021-05-01", to: "2026-12-02" },
};

const FILES: Record<string, unknown> = {
  "meta.json": META,
  "indicators.json": { asOf: "x", fredEnabled: true, count: 0, indicators: [] },
  "news.json": { asOf: "x", count: 0, items: [] },
  "calendar.json": {
    enabled: true,
    count: 3,
    items: [
      { name: "CPI", releaseDate: "2026-06-04", source: "FRED" },
      { name: "PPI", releaseDate: "2026-06-05", source: "FRED" },
      { name: "NFP", releaseDate: "2026-06-12", source: "FRED" },
    ],
  },
  "curves-ust.json": { enabled: true, asOf: "2026-06-05", tenors: [], curves: {} },
  "events.json": {
    from: "2021-05-01",
    to: "2026-12-02",
    count: 3,
    events: [
      { date: "2025-12-10", type: "FOMC", label: "FOMC" },
      { date: "2026-05-13", type: "CPI", label: "CPI" },
      { date: "2026-06-17", type: "FOMC", label: "FOMC" },
    ],
  },
  "history/SPY/1Y.json": { id: "SPY", range: "1Y", points: [{ date: "2026-06-05", value: 1 }] },
};

/** Fake fetch over FILES under `root`; records every URL requested. */
function fakeFetch(root = "/snapshot/") {
  const calls: string[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push(init?.method ? `${init.method} ${url}` : url);
    const key = url.startsWith(root) ? url.slice(root.length) : null;
    if (key === null || !(key in FILES)) {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    return new Response(JSON.stringify(FILES[key]), { status: 200 });
  };
  return { impl, calls };
}

describe("default export", () => {
  it("is the live API when VITE_DATA_MODE is unset", () => {
    expect(DATA_MODE).toBe("live");
    expect(typeof api.indicators).toBe("function");
  });
});

describe("snapshot api", () => {
  it("reads each top-level file under <base>/snapshot/", async () => {
    const { impl, calls } = fakeFetch();
    const a = createSnapshotApi("/", impl);
    expect(await a.indicators()).toEqual(FILES["indicators.json"]);
    expect(await a.news()).toEqual(FILES["news.json"]);
    expect(await a.ustCurve()).toEqual(FILES["curves-ust.json"]);
    expect(calls).toEqual([
      "/snapshot/indicators.json",
      "/snapshot/news.json",
      "/snapshot/curves-ust.json",
    ]);
  });

  it("honours a non-root base path, with or without the trailing slash", async () => {
    for (const base of ["/macro/", "/macro"]) {
      const { impl, calls } = fakeFetch("/macro/snapshot/");
      await createSnapshotApi(base, impl).indicators();
      expect(calls).toEqual(["/macro/snapshot/indicators.json"]);
    }
  });

  it("maps meta.json onto the live /api/meta shape", async () => {
    const a = createSnapshotApi("/", fakeFetch().impl);
    expect(await a.meta()).toEqual({
      fredEnabled: true,
      categories: ["Equities", "Rates"],
      lastRefreshed: META.generatedAt,
    });
    expect(await a.snapshotMeta()).toEqual(META);
  });

  it("serves history files the snapshot lists", async () => {
    const a = createSnapshotApi("/", fakeFetch().impl);
    expect(await a.history("SPY", "1Y")).toEqual(FILES["history/SPY/1Y.json"]);
  });

  it("returns an empty series, without a request, for history the snapshot lacks", async () => {
    const { impl, calls } = fakeFetch();
    const a = createSnapshotApi("/", impl);
    expect(await a.history("SPY", "1W")).toEqual({ id: "SPY", range: "1W", points: [] });
    expect(await a.history("NOPE", "1Y")).toEqual({ id: "NOPE", range: "1Y", points: [] });
    expect(await a.history("../meta", "1Y")).toEqual({ id: "../meta", range: "1Y", points: [] });
    expect(calls).toEqual(["/snapshot/meta.json"]);
  });

  it("propagates a listed-but-missing history file as an error", async () => {
    const a = createSnapshotApi("/", fakeFetch().impl);
    await expect(a.history("SPY", "5Y")).rejects.toThrow(/404/);
  });

  it("filters the one events file to the requested window, inclusive", async () => {
    const { impl, calls } = fakeFetch();
    const a = createSnapshotApi("/", impl);
    const r = await a.events("2026-05-13", "2026-06-17");
    expect(r).toEqual({
      from: "2026-05-13",
      to: "2026-06-17",
      count: 2,
      events: [
        { date: "2026-05-13", type: "CPI", label: "CPI" },
        { date: "2026-06-17", type: "FOMC", label: "FOMC" },
      ],
    });
    expect((await a.events("2020-01-01", "2020-12-31")).count).toBe(0);
    expect(calls.filter((c) => c.endsWith("events.json"))).toHaveLength(1); // memoised
  });

  it("drops calendar releases that are already past for the viewer", async () => {
    const a = createSnapshotApi("/", fakeFetch().impl, () => "2026-06-05");
    const c = await a.calendar();
    expect(c.items.map((i) => i.name)).toEqual(["PPI", "NFP"]);
    expect(c.count).toBe(2);
  });

  it("leaves a disabled calendar alone", async () => {
    const files = { ...FILES, "calendar.json": { enabled: false, items: [] } };
    const impl = async (url: string) =>
      new Response(JSON.stringify(files[url.replace("/snapshot/", "")]), { status: 200 });
    const c = await createSnapshotApi("/", impl, () => "2026-06-05").calendar();
    expect(c).toEqual({ enabled: false, items: [] });
  });

  it("refresh is a no-op that makes no request", async () => {
    const { impl, calls } = fakeFetch();
    await createSnapshotApi("/", impl).refresh();
    expect(calls).toEqual([]);
  });

  it("memoises files but retries one that failed", async () => {
    let fail = true;
    const calls: string[] = [];
    const impl = async (url: string) => {
      calls.push(url);
      if (fail) return new Response("", { status: 503, statusText: "Unavailable" });
      return new Response(JSON.stringify(FILES["news.json"]), { status: 200 });
    };
    const a = createSnapshotApi("/", impl);
    await expect(a.news()).rejects.toThrow(/503/);
    fail = false;
    await a.news();
    await a.news();
    expect(calls).toEqual(["/snapshot/news.json", "/snapshot/news.json"]);
  });
});

describe("live api", () => {
  it("hits the /api routes with encoded params", async () => {
    const calls: string[] = [];
    const impl = async (url: string, init?: RequestInit) => {
      calls.push(init?.method ? `${init.method} ${url}` : url);
      return new Response("{}", { status: 200 });
    };
    const a = createLiveApi(impl);
    await a.indicators();
    await a.history("GOLD_SILVER", "YTD");
    await a.events("2026-01-01", "2026-12-31");
    await a.refresh();
    expect(await a.snapshotMeta()).toBeNull();
    expect(calls).toEqual([
      "/api/indicators",
      "/api/indicators/GOLD_SILVER/history?range=YTD",
      "/api/events?from=2026-01-01&to=2026-12-31",
      "POST /api/refresh",
    ]);
  });

  it("throws on a non-2xx response", async () => {
    const a = createLiveApi(async () => new Response("", { status: 500, statusText: "Boom" }));
    await expect(a.news()).rejects.toThrow("/api/news -> 500 Boom");
  });
});

describe("localIsoDate", () => {
  it("uses local calendar fields, zero-padded", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
