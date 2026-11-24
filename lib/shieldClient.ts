"use client";

import { useEffect, useState } from "react";
import type { Finding, RiskLevel } from "./shield.ts";

/* Browser side of Wallet Shield: fetch a wallet's scan (shared between the badge in the top bar and the Shield tab, refreshed every minute) and
   screen a transaction before it is signed. Types only are imported from shield.ts, so web3.js stays out of the first page load. */

export interface ScanResult {
  address: string; sol: number | null; score: number; level: RiskLevel; findings: Finding[];
  holdings: { mint: string; pubkey: string; amount: string; decimals: number; ui: number; findings: Finding[] }[];
  approvals: { account: string; mint: string; delegate?: string; amount?: string }[] | null;
  recent: { signature: string; ts: number; ok: boolean }[] | null;
  degraded: string[]; complete: boolean; ts: number;
}
export type ScanState = { status: "idle" } | { status: "loading"; prev?: ScanResult } | { status: "error"; prev?: ScanResult } | { status: "ok"; data: ScanResult };

const cache = new Map<string, ScanResult>();

export async function fetchScan(address: string): Promise<ScanResult> {
  const r = await fetch(`/api/shield/scan?address=${encodeURIComponent(address)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  const d = (await r.json()) as ScanResult;
  cache.set(address, d);
  return d;
}

/** Scan an address now and then every `everyMs` while mounted. `null` address = idle. */
export function useScan(address: string | null, everyMs = 60_000): [ScanState, () => void] {
  const [s, setS] = useState<{ address: string | null; v: ScanState }>({ address: null, v: { status: "idle" } });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!address) return;
    let alive = true;
    const run = () => {
      const prev = cache.get(address);
      if (alive && !prev) setS({ address, v: { status: "loading" } });
      fetchScan(address)
        .then((data) => alive && setS({ address, v: { status: "ok", data } }))
        .catch(() => alive && setS({ address, v: { status: "error", prev } }));
    };
    run();
    const t = setInterval(run, everyMs);
    return () => { alive = false; clearInterval(t); };
  }, [address, everyMs, tick]);
  const v = address && s.address === address ? s.v : address && cache.has(address) ? ({ status: "ok", data: cache.get(address)! } as ScanState) : { status: "idle" as const };
  return [v, () => setTick((n) => n + 1)];
}

export interface ScreenResponse { verdict: "safe" | "review" | "block"; findings: Finding[]; programs: string[]; simulated: { ok: boolean; solDeltaLamports?: string; error?: string } | null }

/** Ask the server what an unsigned transaction would let happen. Returns null if the screen itself couldn't run (never a fake "safe"). */
export async function screenBeforeSign(txBase64: string, address: string): Promise<ScreenResponse | null> {
  try {
    const r = await fetch("/api/shield/screen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: txBase64, address }) });
    return r.ok ? ((await r.json()) as ScreenResponse) : null;
  } catch {
    return null;
  }
}
