import { useSyncExternalStore } from "react";

/* Trades made through this app, remembered in this browser only (never sent anywhere). They give an open position a cost
   basis, so its profit and loss can be shown. Amounts come from the quote the wallet signed (its expected output), so
   figures are close, not to-the-last-digit. Coins bought elsewhere have no basis here, and say so. */

export interface Fill { coin: string; side: "buy" | "sell"; tokensRaw: string; decimals: number; usd: number; /** SOL put in (buy) or taken out (sell), from the signed quote */ sol?: number; ts: number; /** shown in the positions list; older fills have none */ ticker?: string }

const KEY = "nb_fills";
const MAX = 200;

export function parseFills(raw: string | null): Fill[] {
  try {
    const v = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((f): f is Fill =>
      !!f && typeof f === "object" &&
      typeof (f as Fill).coin === "string" && ((f as Fill).side === "buy" || (f as Fill).side === "sell") &&
      typeof (f as Fill).tokensRaw === "string" && /^\d+$/.test((f as Fill).tokensRaw) &&
      Number.isInteger((f as Fill).decimals) && (f as Fill).decimals >= 0 && (f as Fill).decimals <= 18 &&
      Number.isFinite((f as Fill).usd) && (f as Fill).usd >= 0 && Number.isFinite((f as Fill).ts) &&
      ((f as Fill).sol === undefined || (Number.isFinite((f as Fill).sol) && (f as Fill).sol! >= 0))).slice(-MAX);
  } catch {
    return [];
  }
}

export interface Position { held: number; value: number; tracked: number; basis: number; pnl: number | null; pnlPct: number | null }

/** Average-cost position for one coin from its fills (oldest first) and what the wallet holds now. */
export function positionFor(fills: Fill[], heldRaw: bigint, decimals: number, priceUsd: number): Position {
  const d = 10 ** decimals;
  let qty = 0, cost = 0;
  for (const f of fills) {
    const t = Number(f.tokensRaw) / 10 ** f.decimals;
    if (f.side === "buy") { qty += t; cost += f.usd; }
    else if (qty > 0) {
      const sold = Math.min(t, qty);
      cost -= cost * (sold / qty);
      qty -= sold;
    }
  }
  const held = Number(heldRaw) / d;
  const tracked = Math.min(qty, held);
  const basis = qty > 0 ? cost * (tracked / qty) : 0;
  const value = held * priceUsd;
  const hasBasis = tracked > 0 && basis > 0;
  const pnl = hasBasis ? tracked * priceUsd - basis : null;
  return { held, value, tracked, basis, pnl, pnlPct: hasBasis && pnl !== null ? (pnl / basis) * 100 : null };
}

let cache: Fill[] | null = null;
const subs = new Set<() => void>();
const read = (): Fill[] => {
  if (cache) return cache;
  try { cache = parseFills(localStorage.getItem(KEY)); } catch { cache = []; }
  return cache;
};
const EMPTY: Fill[] = [];

export function recordFill(f: Fill): void {
  cache = [...read(), f].slice(-MAX);
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage blocked: kept for this session */ }
  subs.forEach((s) => s());
}

export const useFills = (): Fill[] =>
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, read, () => EMPTY);
