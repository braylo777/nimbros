"use client";

import { useEffect, useState } from "react";

/* Homepage activity numbers from /api/stats: how many trades agents have made, and how much they've
   moved in the last 24h. Polled while mounted; null until the first successful read. */
export interface PlatformStats { activeAgents: number; agentTxns: number; vol24hUsd: number }

const POLL_MS = 30_000;

export function usePlatformStats(): PlatformStats | null {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () => {
      fetch("/api/stats", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<PlatformStats>) : Promise.reject(new Error(String(r.status)))))
        .then((s) => {
          if (alive && typeof s.agentTxns === "number") setStats(s);
        })
        .catch(() => { /* keep showing the last good value */ });
    };
    run();
    const t = setInterval(run, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return stats;
}
