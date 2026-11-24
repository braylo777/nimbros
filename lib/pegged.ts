import { useSyncExternalStore } from "react";
import type { Token } from "./types.ts";

/* NimBros-pegged tokens (e.g. BONKNMBR): a branded coin launched through NimBros
   for an underlying coin. Not backed by or redeemable for the underlying.
   Keyed by the underlying coin type. The list is shared: /api/peg returns the
   coins that were launched here and verified on-chain. A token gets the pegging
   visual only once it is listed, so the badge never shows on something that
   doesn't exist. */
export interface Peg { pegSymbol: string; coinType: string }
let PEGGED: Record<string, Peg> = {};
const subs = new Set<() => void>();

export function setPegs(p: Record<string, Peg>) {
  PEGGED = p;
  subs.forEach((f) => f());
}
export const usePegs = () =>
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => PEGGED, () => PEGGED);

export const isPegged = (t: Pick<Token, "contract">): boolean => t.contract in PEGGED;
export const pegOf = (t: Pick<Token, "contract">): Peg | undefined => PEGGED[t.contract];
/** Launchable NMBR symbol: base ticker cut to 5 chars + "NMBR" (launch symbols max 10, start with a letter). */
export function pegSymbol(ticker: string): string {
  const base = ticker.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^[0-9]+/, "");
  return `${base.slice(0, 5)}NMBR`;
}
export const nmbrTicker = (t: Pick<Token, "ticker">): string => pegSymbol(t.ticker);
export const pegTicker = (t: Pick<Token, "contract" | "ticker">): string =>
  isPegged(t) ? pegSymbol(t.ticker) : t.ticker;

/** Load the shared list (browser). Failure keeps whatever is already known. */
export async function loadPegs(): Promise<void> {
  try {
    const r = await fetch("/api/peg", { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return;
    const j = (await r.json()) as Record<string, Peg>;
    if (j && typeof j === "object") setPegs(j);
  } catch {
    /* keep current */
  }
}
/** Tell the shared list about a fresh launch; the server verifies it on-chain. */
export async function registerPeg(underlying: string, ticker: string, coinType: string): Promise<boolean> {
  try {
    const r = await fetch("/api/peg", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ underlying, ticker, coinType }),
    });
    if (r.ok) { await loadPegs(); return true; }
  } catch { /* falls through */ }
  return false;
}
