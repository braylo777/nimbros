/* Pool-depth math. PURE: no I/O, no clock, no randomness.

   The one thing this file answers: given a pool's real depth, what would it cost (in price
   impact) to sell a given size into it right now? That's what `lib/risk.ts`'s exit-cost row and
   the entry score's exit factor (`lib/score.ts`) are built on.

   Two models:
     "pool"     — the pool's REAL reserves (from DexScreener), priced on the constant-product
                  curve x*y=k. What a market order would actually pay, ignoring routing and
                  concentrated ranges.
     "estimate" — no reserves available, so impact falls back to a crude 2 x trade / total
                  liquidity. Deliberately pessimistic-ish and labelled in the UI, because a guess
                  must never look exact. */

export type FillModel = "pool" | "estimate";

/** What's known about a pool's depth. */
export interface Depth {
  liquidityUsd: number;
  /** base tokens in the pool */
  reserveBase?: number;
  /** USD value of the other side of the pool */
  reserveQuoteUsd?: number;
}

export interface TokenRef { id: string; contract?: string; ticker: string; name: string; logo?: string }

const hasReserves = (d: Depth): d is Depth & { reserveBase: number; reserveQuoteUsd: number } =>
  d.reserveBase !== undefined && d.reserveQuoteUsd !== undefined && d.reserveBase > 0 && d.reserveQuoteUsd > 0;

/**
 * Selling: push `qty` base into the pool. The average price received is
 * spot x (1 - dx/(x+dx)) — impact grows toward 100% as you approach the whole
 * reserve, which is the honest shape for a large exit.
 */
export function sellImpact(qty: number, priceUsd: number, d: Depth): { impact: number; model: FillModel } {
  if (hasReserves(d)) return { impact: qty / (d.reserveBase + qty), model: "pool" };
  const gross = qty * priceUsd;
  return { impact: d.liquidityUsd > 0 ? (2 * gross) / d.liquidityUsd : Infinity, model: "estimate" };
}
