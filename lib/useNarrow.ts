import { useSyncExternalStore } from "react";

/** True on phone-width screens. Server and first paint say false, so hydration matches. */
export function useNarrow(maxPx = 640): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(`(max-width:${maxPx}px)`);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(`(max-width:${maxPx}px)`).matches,
    () => false,
  );
}
