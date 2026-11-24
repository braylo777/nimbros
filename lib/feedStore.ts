import { useSyncExternalStore } from "react";
import type { Token } from "./types.ts";
import { loadFeedRows } from "./feedClient.ts";

/* Module-level store for the live feeds, so Home, Trade and PredDetail all read
   the same rows. Last good data is kept when a refresh fails; before the first
   success the status is "loading"/"error" and the lists are EMPTY (no fake fallback). */

export type FeedStatus = "loading" | "ok" | "error";
export type Kind = "snipe" | "scalp";
export interface FeedState {
  snipes: Token[];
  scalps: Token[];
  status: Record<Kind, FeedStatus>;
  ts: Record<Kind, number>;
  stale: Record<Kind, boolean>;
  /** true when this list came from the backup source, which cannot see brand-new pools */
  degraded: Record<Kind, boolean>;
  sources: string[];
}

let state: FeedState = {
  snipes: [],
  scalps: [],
  status: { snipe: "loading", scalp: "loading" },
  ts: { snipe: 0, scalp: 0 },
  stale: { snipe: false, scalp: false },
  degraded: { snipe: false, scalp: false },
  sources: [],
};
const subs = new Set<() => void>();
const set = (n: FeedState) => {
  state = n;
  subs.forEach((f) => f());
};

export const getFeed = () => state;
export const useFeed = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state
  );

type K = Kind;

/* The last good list is kept in localStorage, so a repeat visit paints real tokens
   immediately and refreshes them behind the scenes. Every access is guarded. */
const CACHE_KEY = (k: K) => `nb_feed_${k}`;
const CACHE_MAX_AGE_MS = 6 * 3600 * 1000;

function readCache(k: K): { rows: Token[]; ts: number } | null {
  try {
    const j = JSON.parse(localStorage.getItem(CACHE_KEY(k)) ?? "null") as { rows?: unknown; ts?: unknown } | null;
    if (!j || !Array.isArray(j.rows) || typeof j.ts !== "number" || Date.now() - j.ts > CACHE_MAX_AGE_MS) return null;
    return { rows: (j.rows as Token[]).slice(0, 60), ts: j.ts };
  } catch {
    return null;
  }
}
function writeCache(k: K, rows: Token[], ts: number) {
  try {
    localStorage.setItem(CACHE_KEY(k), JSON.stringify({ rows: rows.slice(0, 60), ts }));
  } catch {
    /* quota or blocked: fine, this is only a speed-up */
  }
}

function apply(k: K, rows: Token[], ts: number, sources: string[], stale: boolean) {
  const key = k === "snipe" ? "snipes" : "scalps";
  set({
    ...state,
    [key]: rows,
    status: { ...state.status, [k]: "ok" },
    ts: { ...state.ts, [k]: ts },
    stale: { ...state.stale, [k]: stale },
    degraded: { ...state.degraded, [k]: false },
    sources: [...new Set([...state.sources, ...sources])],
  });
}

let primed = false;
/** Show the cached lists straight away (once), before the network answers. */
function prime() {
  if (primed) return;
  primed = true;
  (["snipe", "scalp"] as K[]).forEach((k) => {
    const c = readCache(k);
    if (c && state.ts[k] === 0) apply(k, c.rows, c.ts, [], true);
  });
}

async function load(k: K) {
  try {
    const r = await loadFeedRows(k);
    apply(k, r.rows, r.ts, r.sources, r.stale);
    if (!r.stale) for (const t of r.rows) { fresh.set(t.id, t.price); } // re-anchor the 1s ticker to this fresh price
    writeCache(k, r.rows, r.ts);
  } catch {
    // keep whatever we already show; only flag an error if there is nothing at all
    const had = state.ts[k] > 0;
    set({ ...state, status: { ...state.status, [k]: had ? "ok" : "error" } });
  }
}

/* Live price ticks every couple of seconds, from Jupiter's price index through our own edge-cached /api/prices (one read serves every tab).
   Only rows from a fresh feed read are ticked, never the cached ones. A tick that jumps more than 50x from the last fresh price is dropped as bad data. */
const fresh = new Map<string, number>();
async function liveTick() {
  const rows = [...state.snipes, ...state.scalps].filter((t) => fresh.has(t.id)).slice(0, 40);
  if (rows.length === 0) return;
  try {
    const r = await fetch(`/api/prices?ids=${rows.map((t) => t.contract).join(",")}`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return;
    const px = (await r.json()) as Record<string, number>;
    const next = new Map<string, { price: number; mc: number }>();
    for (const t of rows) {
      const p = px[t.contract];
      const a = fresh.get(t.id)!;
      if (typeof p === "number" && p > 0 && Number.isFinite(p) && p < a * 50 && p > a / 50) next.set(t.id, { price: p, mc: t.marketCap && t.price > 0 ? t.marketCap * (p / t.price) : t.marketCap });
    }
    if (next.size === 0) return;
    const upd = (ts: Token[]) => ts.map((t) => (next.has(t.id) ? { ...t, price: next.get(t.id)!.price, marketCap: next.get(t.id)!.mc } : t));
    set({ ...state, snipes: upd(state.snipes), scalps: upd(state.scalps) });
  } catch {
    /* keep showing the last price */
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let liveTimer: ReturnType<typeof setInterval> | null = null;
/** Start polling (idempotent). Returns a stop function. */
export function startFeeds(everyMs = 45_000): () => void {
  prime();
  const all = () => (["snipe", "scalp"] as K[]).forEach(load);
  all();
  if (!timer) timer = setInterval(() => document.visibilityState === "visible" && all(), everyMs);
  if (!liveTimer) liveTimer = setInterval(() => document.visibilityState === "visible" && void liveTick(), 2500);
  return () => {
    if (timer) clearInterval(timer);
    if (liveTimer) clearInterval(liveTimer);
    timer = null;
    liveTimer = null;
  };
}

/** Live price by token id, from whatever the feeds currently carry. */
export function marksFrom(f: FeedState): Record<string, number> {
  const m: Record<string, number> = {};
  for (const t of [...f.snipes, ...f.scalps]) {
    if (!(t.price > 0)) continue;
    m[t.id] = t.price;
    m[t.contract] = t.price; // keyed by contract too, which survives a change of pool
  }
  return m;
}
