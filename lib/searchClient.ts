"use client";

import { useEffect, useState } from "react";
import type { Token } from "./types.ts";

/** Coins matching a search, of any age, from our server (which reads the public DEX search). Waits for a pause in typing. */
export function useCoinSearch(q: string): { rows: Token[]; loading: boolean } {
  const term = q.trim();
  const [got, setGot] = useState<{ q: string; rows: Token[] } | null>(null);
  useEffect(() => {
    if (term.length < 2) return;
    let alive = true;
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal })
        .then((r) => r.json())
        .then((j: { rows?: Token[] }) => { if (alive) setGot({ q: term, rows: Array.isArray(j.rows) ? j.rows : [] }); })
        .catch(() => { if (alive) setGot({ q: term, rows: [] }); });
    }, 250);
    return () => { alive = false; clearTimeout(id); ctl.abort(); };
  }, [term]);
  const fresh = got && got.q === term ? got.rows : null;
  return { rows: fresh ?? [], loading: term.length >= 2 && fresh === null };
}
