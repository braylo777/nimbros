"use client";

import { useEffect, useState } from "react";
import { normType } from "./tradingview.ts";

/** Coin types launched or traded on NimBros (normalised for comparison). null until the first read. */
export function usePlatformCoins(): Set<string> | null {
  const [set, setSet] = useState<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () =>
      fetch("/api/platform")
        .then((r) => (r.ok ? (r.json() as Promise<{ coins?: string[] }>) : Promise.reject(new Error(String(r.status)))))
        .then((j) => alive && Array.isArray(j.coins) && setSet(new Set(j.coins.map(normType))))
        .catch(() => {});
    void run();
    const t = setInterval(run, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return set;
}
