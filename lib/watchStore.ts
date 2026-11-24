"use client";

import { useSyncExternalStore } from "react";
import { parseWatch, toggleWatch, type WatchItem } from "./watchlist.ts";
import type { Token } from "./types.ts";

/* Watchlist in localStorage (guarded), loaded post-mount to keep the first render deterministic. */
const K = "nb_watch_v1";
let items: WatchItem[] = [];
let hydrated = false;
const subs = new Set<() => void>();
const set = (n: WatchItem[]) => {
  items = n;
  subs.forEach((f) => f());
};

export const useWatch = () =>
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => items, () => items);

export function hydrateWatch() {
  if (hydrated) return;
  hydrated = true;
  try {
    set(parseWatch(localStorage.getItem(K)));
  } catch {
    /* storage blocked: the list just starts empty */
  }
}

export function toggleWatchFor(t: Token, now = Date.now()) {
  const next = toggleWatch(items, {
    id: t.id, ticker: t.ticker, name: t.name, logo: t.logo, addedAt: now, priceAtAdd: t.price, liquidityAtAdd: t.liquidity,
  });
  try {
    localStorage.setItem(K, JSON.stringify(next));
  } catch {
    /* non-fatal */
  }
  set(next);
}

export function removeWatch(id: string) {
  const next = items.filter((i) => i.id !== id);
  try {
    localStorage.setItem(K, JSON.stringify(next));
  } catch {
    /* non-fatal */
  }
  set(next);
}
