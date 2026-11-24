import { useSyncExternalStore } from "react";

/* The receipt shown after a fill: what was paid, what was expected, price impact, fee, and the on-chain signature. Figures come from the quote the wallet signed. */
export interface Receipt { side: "buy" | "sell"; ticker: string; paid: string; got: string; impactPct: number | null; feeBps: number | null; networkSol: number | null; sig: string; ts: number }
let cur: Receipt | null = null;
const subs = new Set<() => void>();
export const showReceipt = (r: Receipt) => { cur = r; subs.forEach((f) => f()); };
export const closeReceipt = () => { cur = null; subs.forEach((f) => f()); };
export const useReceipt = (): Receipt | null => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => cur, () => null);
