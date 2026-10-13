import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { getMediaQuerySnapshot, subscribeMediaQuery, useMediaQuery } from "../src/useMediaQuery";

// Minimal matchMedia: one MediaQueryList per query, with listeners we can fire.
function fakeMatchMedia(initial: Record<string, boolean>) {
  const lists = new Map<string, { matches: boolean; listeners: Set<() => void> }>();
  const get = (q: string) => {
    if (!lists.has(q)) lists.set(q, { matches: initial[q] ?? false, listeners: new Set() });
    return lists.get(q)!;
  };
  const matchMedia = (q: string) => {
    const l = get(q);
    return {
      get matches() {
        return l.matches;
      },
      addEventListener: (_: string, fn: () => void) => l.listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => l.listeners.delete(fn),
    };
  };
  const set = (q: string, matches: boolean) => {
    get(q).matches = matches;
    for (const fn of get(q).listeners) fn();
  };
  return { matchMedia, set, listenerCount: (q: string) => get(q).listeners.size };
}

afterEach(() => vi.unstubAllGlobals());

describe("useMediaQuery store", () => {
  it("reads the current match for the query", () => {
    const mm = fakeMatchMedia({ "(max-width: 1023px)": true });
    vi.stubGlobal("window", { matchMedia: mm.matchMedia });
    expect(getMediaQuerySnapshot("(max-width: 1023px)")).toBe(true);
    expect(getMediaQuerySnapshot("(min-width: 2000px)")).toBe(false);
    mm.set("(max-width: 1023px)", false);
    expect(getMediaQuerySnapshot("(max-width: 1023px)")).toBe(false);
  });

  it("notifies subscribers on change and unsubscribes cleanly", () => {
    const mm = fakeMatchMedia({});
    vi.stubGlobal("window", { matchMedia: mm.matchMedia });
    const onChange = vi.fn();
    const unsubscribe = subscribeMediaQuery("(orientation: portrait)", onChange);
    expect(mm.listenerCount("(orientation: portrait)")).toBe(1);
    mm.set("(orientation: portrait)", true);
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(mm.listenerCount("(orientation: portrait)")).toBe(0);
    mm.set("(orientation: portrait)", false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("renders false on the server (no window)", () => {
    function Probe() {
      return createElement("span", null, String(useMediaQuery("(max-width: 1023px)")));
    }
    expect(renderToString(createElement(Probe))).toBe("<span>false</span>");
  });
});
