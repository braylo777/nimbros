import { useSyncExternalStore } from "react";
import { EMPTY_FILTERS, type UserFilters } from "./userFilters.ts";

/* The main page's filters, remembered in this browser. */
const KEY = "nb_filters";
let state: UserFilters = EMPTY_FILTERS;
let hydrated = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function clean(j: unknown): UserFilters {
  const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  return {
    q: typeof o.q === "string" ? o.q.slice(0, 80) : "",
    minLiq: num(o.minLiq), maxLiq: num(o.maxLiq), minVol: num(o.minVol), maxVol: num(o.maxVol), minMcap: num(o.minMcap), maxMcap: num(o.maxMcap),
    minAgeMin: num(o.minAgeMin), maxAgeMin: num(o.maxAgeMin), minChange: num(o.minChange), maxChange: num(o.maxChange),
    minTxns: num(o.minTxns), maxTxns: num(o.maxTxns), minBuyPct: num(o.minBuyPct), maxBuyPct: num(o.maxBuyPct),
    minTurn: num(o.minTurn), maxTurn: num(o.maxTurn), minLiqPct: num(o.minLiqPct), maxLiqPct: num(o.maxLiqPct),
    dex: Array.isArray(o.dex) ? o.dex.filter((d): d is string => typeof d === "string").slice(0, 20) : [],
  };
}

export function hydrateFilters() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { state = clean(JSON.parse(raw)); emit(); }
  } catch { /* start with no filters */ }
}
export const useFilters = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => EMPTY_FILTERS);
export function setFilters(next: UserFilters) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* fine */ }
  emit();
}
export const resetFilters = () => setFilters(EMPTY_FILTERS);
