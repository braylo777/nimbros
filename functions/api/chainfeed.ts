import { CHAINS, isChain, normalizeChainPools } from "../../lib/chainfeed.ts";

/* GET /api/chainfeed?chain=base|bsc|eth → fresh and trending pools on another chain (GeckoTerminal), same shape for every chain, with plain red-flag hints.
   Discovery only: NimBros swaps are Solana-only for now, so each row links out. Edge-cached 45 s so any number of viewers is one upstream call per chain. */

const get = async (url: string) => {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000), cf: { cacheTtl: 45, cacheEverything: true } } as RequestInit);
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.json();
};
const out = (b: unknown, status: number, cache: string) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": cache } });

export async function onRequestGet({ request }: { request: Request }): Promise<Response> {
  const chain = new URL(request.url).searchParams.get("chain");
  if (!isChain(chain)) return out({ error: "chain must be base, bsc or eth" }, 400, "no-store");
  const n = CHAINS[chain].network;
  const base = `https://api.geckoterminal.com/api/v2/networks/${n}`;
  const pages = await Promise.allSettled([`${base}/new_pools?include=base_token&page=1`, `${base}/new_pools?include=base_token&page=2`, `${base}/trending_pools?include=base_token&page=1`].map(get));
  const ok = pages.flatMap((p) => (p.status === "fulfilled" ? [p.value] : []));
  if (ok.length === 0) return out({ error: "unavailable" }, 503, "no-store");
  return out({ chain, name: CHAINS[chain].name, rows: normalizeChainPools(ok, chain), ts: Date.now() }, 200, "public, s-maxage=45, stale-while-revalidate=60");
}
