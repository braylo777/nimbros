import { fallbackRows, parsePairs } from "../../lib/dexscreener.ts";
import { json } from "../../lib/agentHttp.ts";

/* GET /api/search?q=bonk → { rows: Token[] }  Every Solana coin that matches, of any age. The Snipe and Scalp lists only carry recent runners, so this is
   how an old or quiet coin is found. Read from DexScreener's public search (no key); the deepest pool represents each coin. Cached two minutes at the edge. */
const STABLE = new Set(["USDC", "USDT", "PYUSD", "USDS", "USDE", "DAI"]);
export async function onRequestGet({ request }: { request: Request }): Promise<Response> {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  if (q.length < 2) return json({ rows: [] }, 200, "public, s-maxage=60");
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(6000), cf: { cacheTtl: 120, cacheEverything: true } } as RequestInit);
    if (!r.ok) return json({ rows: [] }, 200, "no-store");
    const pairs = parsePairs(await r.json()).filter((p) => p.token.liquidity >= 200);
    const rows = fallbackRows(pairs, "agent", (t) => !STABLE.has(t.ticker.toUpperCase()))
      .sort((a, b) => b.liquidity - a.liquidity)
      .slice(0, 30);
    return json({ rows }, 200, "public, s-maxage=120, stale-while-revalidate=600");
  } catch { return json({ rows: [] }, 200, "no-store"); }
}
