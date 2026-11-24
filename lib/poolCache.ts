import type { Token } from "./types.ts";

/* The pre-built token cache. A scheduled job reads every Solana exchange and launchpad, merges what it finds here, and stores ready-made
   Snipe and Scalp lists, so a visitor's request is one fast read instead of a slow trip to several data providers. */

export interface CachedPool extends Token { seen: number }
export const STALE_MS = 45 * 60_000; // a pool nobody has reported for this long is dropped
export const MAX_POOLS = 1_200;

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
/** The Solana exchanges and launchpads GeckoTerminal indexes today. The live list is merged in on top, so new exchanges appear by themselves, but
    if that one call fails coverage doesn't shrink. */
export const KNOWN_DEXES = ["pump-fun", "pumpswap", "raydium-launchlab", "letsbonk-fun", "moonshot", "moonit", "meteora-dbc", "meteora-damm-v2", "meteora", "raydium", "raydium-clmm", "orca", "boop-fun", "bags-fm", "heaven", "wavebreak", "zora", "stonkfun", "daos-fun", "token-mill", "printr-v2", "virtuals-solana"];
export const allDexes = (live: string[]): string[] => [...new Set([...KNOWN_DEXES, ...live])];

/** Exchanges GeckoTerminal doesn't index, found through DexScreener search instead. */
export const DS_QUERIES = [
  // launchpads and exchanges
  "pump.fun", "pumpswap", "bonk.fun", "letsbonk", "moonshot", "meteora", "raydium", "orca", "believe", "bags", "boop", "launchlab",
  // broad terms that turn up different coins each time
  "meme", "cat", "dog", "pepe", "ai", "moon", "frog", "baby", "coin", "trump", "bonk", "sol", "wojak", "chill",
];
/** How many searches one refresh runs. DexScreener allows far more than this; GeckoTerminal is the tight one. */
export const DS_PER_RUN = 6;
/** The searches for this run, moving round the list so every term is covered every few runs. */
export function dsQueriesFor(slot: number, perRun = DS_PER_RUN): string[] {
  const start = (Math.max(0, Math.floor(slot)) * perRun) % DS_QUERIES.length;
  return Array.from({ length: Math.min(perRun, DS_QUERIES.length) }, (_, i) => DS_QUERIES[(start + i) % DS_QUERIES.length]);
}

/** Refreshed every run: the pages that change fastest. */
export const HOT_URLS: string[] = [
  `${GT}/new_pools?include=base_token&page=1`,
  `${GT}/trending_pools?include=base_token&page=1`,
  `${GT}/pools?include=base_token&page=1&sort=h24_volume_usd_desc`,
];

/** Everything else, taken a few at a time so the free tier is never near its limit: one page per exchange, second pages, deeper lists. */
export function coldUrls(dexIds: string[]): string[] {
  const perDex = dexIds.map((d) => `${GT}/dexes/${encodeURIComponent(d)}/pools?include=base_token&page=1&sort=h24_volume_usd_desc`);
  const deeper = [
    `${GT}/new_pools?include=base_token&page=2`, `${GT}/new_pools?include=base_token&page=3`,
    `${GT}/trending_pools?include=base_token&page=2`, `${GT}/pools?include=base_token&page=2&sort=h24_volume_usd_desc`, `${GT}/pools?include=base_token&page=3&sort=h24_volume_usd_desc`,
  ];
  const second = ["pump-fun", "pumpswap", "raydium-launchlab", "raydium", "meteora", "orca"].filter((d) => dexIds.includes(d)).map((d) => `${GT}/dexes/${d}/pools?include=base_token&page=2&sort=h24_volume_usd_desc`);
  return [...perDex, ...deeper, ...second];
}

/** The hot pages plus the next `perRun` cold ones, moving round the list as `slot` counts up. */
export function pickSources(dexIds: string[], slot: number, perRun = 5): string[] {
  const cold = coldUrls(dexIds);
  const out = [...HOT_URLS];
  if (cold.length === 0) return out;
  const start = (Math.max(0, Math.floor(slot)) * perRun) % cold.length;
  for (let i = 0; i < Math.min(perRun, cold.length); i++) out.push(cold[(start + i) % cold.length]);
  return out;
}

/** Fold a fresh batch into the cache: newer data wins, enrichment we already have (reserves, logo) is kept, old pools age out. */
export function mergePools(prev: CachedPool[], fresh: Token[], now: number): CachedPool[] {
  const byId = new Map<string, CachedPool>();
  for (const p of prev) if (now - p.seen <= STALE_MS) byId.set(p.id, p);
  for (const t of fresh) {
    const old = byId.get(t.id);
    byId.set(t.id, {
      ...t,
      logo: t.logo ?? old?.logo,
      reserveBase: t.reserveBase ?? old?.reserveBase,
      reserveQuoteUsd: t.reserveQuoteUsd ?? old?.reserveQuoteUsd,
      seen: now,
    });
  }
  return [...byId.values()].sort((a, b) => b.liquidity - a.liquidity || a.id.localeCompare(b.id)).slice(0, MAX_POOLS);
}

/** Rows most worth spending an enrichment call on: the busiest ones still missing reserves. */
export function needsReserves(rows: CachedPool[], limit: number): CachedPool[] {
  return rows.filter((r) => r.reserveQuoteUsd === undefined).sort((a, b) => b.vol24h - a.vol24h).slice(0, limit);
}
