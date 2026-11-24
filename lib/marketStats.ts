import type { Token } from "./types.ts";

/* The numbers in the homepage hero: what is being tracked right now. Pure, so it can be tested. */

export interface MarketStats { coins: number; exchanges: number; volume24h: number; topMover: Token | null }

/** Big percentage moves on dust pools are noise, so a "mover" needs some liquidity and some trading behind it. */
export const MOVER_MIN_LIQ = 5_000;
export const MOVER_MIN_VOL = 2_000;
/** Past this a "move" is a broken price on a new pool, not a run. */
export const MOVER_MAX_PCT = 10_000;
const isMover = (t: Token) => t.liquidity >= MOVER_MIN_LIQ && t.vol24h >= MOVER_MIN_VOL && Number.isFinite(t.changePct) && Math.abs(t.changePct) <= MOVER_MAX_PCT;
/** Same idea, for the past hour specifically: a coin with no 1h figure from the source is never guessed at, so it just isn't a candidate. */
const isMover1h = (t: Token) => t.liquidity >= MOVER_MIN_LIQ && t.vol24h >= MOVER_MIN_VOL && typeof t.changePct1h === "number" && Number.isFinite(t.changePct1h) && Math.abs(t.changePct1h) <= MOVER_MAX_PCT;

export function marketStats(rows: Token[]): MarketStats {
  const seen = new Set<string>();
  const dex = new Set<string>();
  let volume24h = 0;
  for (const t of rows) {
    if (seen.has(t.contract)) continue; // a coin listed in both lists counts once
    seen.add(t.contract);
    if (t.dex) dex.add(t.dex);
    volume24h += t.vol24h || 0;
  }
  const top = topMovers(rows, 1)[0] ?? null;
  return { coins: seen.size, exchanges: dex.size, volume24h, topMover: top };
}

/** The biggest risers with real liquidity behind them, one row per coin. */
export function topMovers(rows: Token[], n: number): Token[] {
  const best = new Map<string, Token>();
  for (const t of rows) {
    if (!isMover(t)) continue;
    const cur = best.get(t.contract);
    if (!cur || t.liquidity > cur.liquidity) best.set(t.contract, t);
  }
  return [...best.values()].sort((a, b) => b.changePct - a.changePct || a.id.localeCompare(b.id)).slice(0, n);
}

/** The biggest risers in the last hour specifically, same liquidity/volume floor. Coins with no 1h figure are left out, not faked —
    but if NONE of the rows carry a 1h figure at all (the upstream source didn't provide it this pass), this falls back to the usual
    24h movers rather than show an empty section: some real number beats none. */
export function topMovers1h(rows: Token[], n: number): Token[] {
  const best = new Map<string, Token>();
  for (const t of rows) {
    if (!isMover1h(t)) continue;
    const cur = best.get(t.contract);
    if (!cur || t.liquidity > cur.liquidity) best.set(t.contract, t);
  }
  if (best.size === 0) return topMovers(rows, n);
  return [...best.values()].sort((a, b) => (b.changePct1h ?? 0) - (a.changePct1h ?? 0) || a.id.localeCompare(b.id)).slice(0, n);
}
