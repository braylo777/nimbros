import { parsePairs } from "./dexscreener.ts";
import { normType } from "./tradingview.ts";
import { COIN_TYPE } from "./feeds.ts";
import type { Depth, TokenRef } from "./depth.ts";

/* Real prices, fetched server-side so a price used to build or check a trade can
   never name its own price: every fill is against the deepest live pool DexScreener reports. */

const DS = "https://api.dexscreener.com/latest/dex/tokens";

export interface Market { price: number; depth: Depth; ref: TokenRef; change24h: number; liquidity: number }

export async function lookup(coin: string, f: typeof fetch = fetch): Promise<Market | null> {
  if (!COIN_TYPE.test(coin) || coin.length > 300) return null;
  try {
    const r = await f(`${DS}/${encodeURIComponent(coin)}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const want = normType(coin);
    const pairs = parsePairs(await r.json()).filter((p) => normType(p.token.contract) === want);
    pairs.sort((a, b) => b.token.liquidity - a.token.liquidity);
    const p = pairs[0];
    if (!p) return null;
    const t = p.token;
    return {
      price: t.price,
      depth: { liquidityUsd: t.liquidity, reserveBase: p.reserves?.base, reserveQuoteUsd: p.reserves?.quoteUsd },
      ref: { id: t.id, contract: t.contract, ticker: t.ticker, name: t.name, logo: t.logo },
      change24h: t.changePct,
      liquidity: t.liquidity,
    };
  } catch {
    return null;
  }
}

/** Marks for many coins at once (DexScreener takes up to 30 per call), keyed by normalized coin type. */
export async function marks(coins: string[], f: typeof fetch = fetch): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = [...new Set(coins.filter((c) => COIN_TYPE.test(c)))];
  for (let i = 0; i < uniq.length; i += 30) {
    const chunk = uniq.slice(i, i + 30);
    try {
      const r = await f(`${DS}/${chunk.map(encodeURIComponent).join(",")}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const best = new Map<string, { liq: number; price: number }>();
      for (const p of parsePairs(await r.json())) {
        const k = normType(p.token.contract);
        const cur = best.get(k);
        if (!cur || p.token.liquidity > cur.liq) best.set(k, { liq: p.token.liquidity, price: p.token.price });
      }
      best.forEach((v, k) => out.set(k, v.price));
    } catch { /* leave unmarked: the account keeps its last seen price */ }
  }
  return out;
}
