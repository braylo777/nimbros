import { buyPressurePct } from "./backtest.ts";
import type { Token } from "./types.ts";

/* Sorting for the homepage lists. A row missing the field being sorted goes last, whichever way you sort. */

export type SortKey = "new" | "name" | "mcap" | "chg" | "liq" | "vol" | "bp";
export interface SortState { key: SortKey; dir: "asc" | "desc" }
export type ListKey = "snipe" | "agent";

/** Fresh coins first for Snipe; the busiest first for Scalp. */
export const DEFAULT_SORT: Record<ListKey, SortState> = { snipe: { key: "new", dir: "asc" }, agent: { key: "vol", dir: "desc" } };

export const SORT_LABEL: Record<SortKey, string> = { new: "Newest", name: "Name", mcap: "Market Cap", chg: "24h change", liq: "Liquidity", vol: "Volume", bp: "Buy pressure" };

const value = (t: Token, k: SortKey): number | string | null => {
  switch (k) {
    case "new": return t.ageMin ?? null;
    case "name": return t.name.toLowerCase();
    case "mcap": return t.marketCap > 0 ? t.marketCap : null;
    case "chg": return Number.isFinite(t.changePct) ? t.changePct : null;
    case "liq": return t.liquidity;
    case "vol": return t.vol24h;
    case "bp": return buyPressurePct(t.buys24h, t.sells24h);
  }
};

export function sortRows(rows: Token[], s: SortState): Token[] {
  const sign = s.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a, s.key), y = value(b, s.key);
    if (x === null && y === null) return a.id.localeCompare(b.id);
    if (x === null) return 1;   // unknown always last
    if (y === null) return -1;
    const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
    return c !== 0 ? c * sign : a.id.localeCompare(b.id);
  });
}

/** Clicking a column: the same column flips direction, a different one starts in its natural direction. */
export function nextSort(cur: SortState, key: SortKey): SortState {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return naturalSort(key);
}

/** The direction a column starts in when you first choose it. */
export const naturalSort = (key: SortKey): SortState => ({ key, dir: key === "new" || key === "name" ? "asc" : "desc" });
