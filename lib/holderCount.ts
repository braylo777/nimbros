"use client";

import { useEffect, useState } from "react";

/* Holder counts for list cards: light /api/holders calls, four at a time, remembered for the session.
   Callers only ask for the first few rows, so a long list never fans out into hundreds of chain reads. */

const done = new Map<string, string | null>();
const waiting: (() => void)[] = [];
let running = 0;

async function fetchCount(coin: string): Promise<string | null> {
  try {
    const r = await fetch(`/api/holders?coin=${encodeURIComponent(coin)}&light=1`);
    if (!r.ok) return null;
    const j = (await r.json()) as { holders?: number; partial?: boolean };
    return typeof j.holders === "number" ? `${j.holders.toLocaleString("en-US")}${j.partial ? "+" : ""}` : null;
  } catch {
    return null;
  }
}

function schedule(coin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const go = async () => {
      running++;
      const n = await fetchCount(coin);
      if (n !== null) done.set(coin, n); // a failed read is retried next time the row shows, not remembered
      running--;
      waiting.shift()?.();
      resolve(n);
    };
    if (running < 4) void go();
    else waiting.push(() => void go());
  });
}

/** undefined while loading, null when it couldn't be read. */
export function useHolderCount(coin: string, enabled: boolean): string | null | undefined {
  const [n, setN] = useState<string | null | undefined>(done.get(coin));
  useEffect(() => {
    if (!enabled || done.has(coin)) return;
    let alive = true;
    void schedule(coin).then((v) => alive && setN(v));
    return () => {
      alive = false;
    };
  }, [coin, enabled]);
  return done.has(coin) ? done.get(coin) : n;
}
