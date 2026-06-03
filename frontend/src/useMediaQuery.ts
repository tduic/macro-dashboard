// Reactive matchMedia hook. Pass a media query, get a boolean that updates
// on resize / orientation change.
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatch(e.matches);
    m.addEventListener("change", handler);
    setMatch(m.matches);
    return () => m.removeEventListener("change", handler);
  }, [query]);

  return match;
}

// Treats anything below the Tailwind `lg` breakpoint as "compact" — that's
// where the news rail goes away and the bottom tab bar appears.
export function useIsCompact(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}
