// Reactive matchMedia hook. Pass a media query, get a boolean that updates
// on resize / orientation change.
import { useCallback, useSyncExternalStore } from "react";

// Subscribe to changes of `query`; returns the unsubscribe function.
export function subscribeMediaQuery(query: string, onChange: () => void): () => void {
  const m = window.matchMedia(query);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

export function getMediaQuerySnapshot(query: string): boolean {
  return window.matchMedia(query).matches;
}

// No window during SSR/prerender: report "no match".
const getServerSnapshot = () => false;

export function useMediaQuery(query: string): boolean {
  // useSyncExternalStore reads the current value during render (so a new
  // `query` is reflected immediately, with no extra effect-driven render) and
  // re-subscribes whenever `query` changes.
  const subscribe = useCallback((onChange: () => void) => subscribeMediaQuery(query, onChange), [query]);
  const getSnapshot = useCallback(() => getMediaQuerySnapshot(query), [query]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Treats anything below the Tailwind `lg` breakpoint as "compact" — that's
// where the news rail goes away and the bottom tab bar appears.
export function useIsCompact(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}
