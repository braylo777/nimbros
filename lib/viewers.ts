"use client";

import { useEffect, useSyncExternalStore } from "react";

/* How many people on NimBros are looking at each coin right now. Counts are read every 20 s; a coin page reports itself every 30 s
   while its tab is visible. Only NimBros visitors are counted, so this is "watching here", not a market-wide number. */

let counts: Record<string, number> = {};
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function pull() {
  if (document.visibilityState === "hidden") return;
  try {
    const r = await fetch("/api/views");
    if (r.ok) { counts = (await r.json()) as Record<string, number>; subs.forEach((f) => f()); }
  } catch { /* keep the last counts */ }
}

function subscribe(f: () => void) {
  subs.add(f);
  if (!timer) { void pull(); timer = setInterval(pull, 20_000); }
  return () => {
    subs.delete(f);
    if (subs.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

/** Viewers of one coin (coin type, any case). */
export const useViewers = (coin: string): number =>
  useSyncExternalStore(subscribe, () => counts[coin] ?? 0, () => 0);

/** Call on a coin page: tells the server this tab is looking at `coin`. */
export function useReportView(coin: string) {
  useEffect(() => {
    const sid = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
    const beat = () => {
      if (document.visibilityState === "hidden") return;
      void fetch("/api/views", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin, sid }) }).catch(() => {});
    };
    beat();
    const t = setInterval(beat, 30_000);
    return () => clearInterval(t);
  }, [coin]);
}
