import { normalizePools, STABLES } from "./feeds.ts";
import type { Token } from "./types.ts";

/* One rule puts every Solana token in exactly one of two lists, or in neither.

     Snipe  coins launched in the last 24 hours that are running (up on the day).
            Get in early, hold the bag, get out. Mostly meme coins.
     Scalp  coins between 1 and 30 days old with real liquidity underneath them and holding up. Anything older is not in the feeds:
            it is found through search.

   Stablecoins are in neither list: a coin pinned to $1 is not something you snipe or scalp.
   Coins that are old AND thin are in neither list either: they are dead, not early.

   Sui's launch-curve platforms don't publish their bonding progress in any source we use, so "proven" is read from what the pool
   holds and how old it is (a market cap number would misjudge coins with different supplies). The thresholds are constants here so
   they can be tuned as the market shows what it does. The same rule runs on the server and in the browser. */

export const GRADUATION_LIQ_USD = 25_000; // real liquidity to trade against
export const FRESH_MIN = 24 * 60;         // younger than a day: still a launch, whatever its liquidity
export const SCALP_MAX_MIN = 30 * 24 * 60; // older than 30 days: no longer a scalp candidate (still findable through search)
export const SNIPE_MIN_CHANGE = 10;       // a Snipe is a runner: up at least this much over 24h
export const SCALP_MIN_CHANGE = 0;        // a Scalp is holding up: not falling over 24h
export const DUST_LIQ_USD = 2_000;   // under this a pool is a placeholder, not a market
/* Quality floor: a coin must be trading right now, not just exist. "TEST" coins and abandoned launches have liquidity on paper and nobody
   on the other side. Brand-new coins (under a day) get a lower trade-count bar because they have had less time to collect trades. */
export const MIN_VOL24_USD = 1_000;
export const MIN_TXNS_24H = 20;
export const MIN_TXNS_24H_NEW = 8;
export const isActive = (t: Pick<Token, "vol24h" | "txns"> & Partial<Pick<Token, "ageMin" | "buys24h" | "sells24h">>): boolean => {
  const trades = Math.max(t.txns ?? 0, (t.buys24h ?? 0) + (t.sells24h ?? 0));
  const fresh = t.ageMin !== undefined && t.ageMin < FRESH_MIN;
  return t.vol24h >= MIN_VOL24_USD && trades >= (fresh ? MIN_TXNS_24H_NEW : MIN_TXNS_24H);
};
export const MAX_ROWS = 150;

export type Stage = "snipe" | "scalp";
export type StageInput = Pick<Token, "liquidity"> & Partial<Pick<Token, "ageMin">>;

/** Which list a coin belongs in, or null when it belongs in neither (a dead coin). */
export function stageOf(t: StageInput): Stage | null {
  const age = t.ageMin;
  if (age !== undefined && age < FRESH_MIN) return "snipe";                       // launched in the last 24 hours
  if (age !== undefined && age > SCALP_MAX_MIN) return null;                        // older than 30 days: search finds it, the feeds do not
  if (age === undefined) return null;                                               // no known age: never guess a coin is young
  if (t.liquidity >= GRADUATION_LIQ_USD) return "scalp";                            // 1 to 30 days old with a real market under it
  if (age === undefined) return null;                                               // no known age: old coins with no launch date on record, not new ones
  return null;                                                                      // past a day and thin: not a scalp yet, not new any more
}

/** A stablecoin by behaviour, whatever it is called (USDC, USAD, USBD…): priced within 3 cents of a dollar and barely moving. A real
    Snipe or Scalp candidate does not sit still at $1.00, so this needs no list of names. */
export const isStable = (t: Pick<Token, "ticker" | "price" | "changePct">): boolean =>
  STABLES.has(t.ticker.toUpperCase()) || (t.price >= 0.97 && t.price <= 1.03 && Math.abs(t.changePct) < 2);

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
/** Where the pools come from: the newest pools (pages 1-2), trending (page 1) and the busiest by 24h volume (pages 1-2).
    Five requests: GeckoTerminal's free tier is 30 a minute and our server shares its address with other sites. */
export const GT_SOURCE_URLS: string[] = [
  ...[1, 2].map((p) => `${GT}/new_pools?include=base_token&page=${p}`),
  `${GT}/trending_pools?include=base_token&page=1`,
  ...[1, 2].map((p) => `${GT}/pools?include=base_token&page=${p}&sort=h24_volume_usd_desc`),
];

/** Drop stablecoins and dust, keep each token's deepest pool, split by stage, and order each list. */
export function splitTokens(rows: Token[]): Record<Stage, Token[]> {
  const best = new Map<string, Token>();
  // a coin's age is its OLDEST pool's, whichever pool ends up representing it below
  const oldest = new Map<string, number>();
  for (const t of rows) if (t.ageMin !== undefined) oldest.set(t.contract, Math.max(oldest.get(t.contract) ?? 0, t.ageMin));
  for (const raw of rows) {
    const t = oldest.has(raw.contract) && oldest.get(raw.contract) !== raw.ageMin ? { ...raw, ageMin: oldest.get(raw.contract) } : raw;
    if (isStable(t) || !(t.liquidity >= DUST_LIQ_USD) || !isActive(t)) continue;
    const cur = best.get(t.contract);
    if (!cur || t.liquidity > cur.liquidity) best.set(t.contract, t);
  }
  const snipe: Token[] = [], scalp: Token[] = [];
  for (const t of best.values()) {
    const stage = stageOf(t);
    // only runners: a new coin has to be up on the day, an established one at least holding up
    if (stage === "snipe" && !(t.changePct >= SNIPE_MIN_CHANGE)) continue;
    if (stage === "scalp" && !(t.changePct >= SCALP_MIN_CHANGE)) continue;
    if (stage === "scalp") scalp.push({ ...t, kind: "agent" });
    else if (stage === "snipe") snipe.push({ ...t, kind: "snipe" });
  }
  snipe.sort((a, b) => (a.ageMin ?? Infinity) - (b.ageMin ?? Infinity) || b.liquidity - a.liquidity || a.id.localeCompare(b.id)); // newest first
  scalp.sort((a, b) => b.vol24h - a.vol24h || a.id.localeCompare(b.id));                                                            // busiest first
  return { snipe: snipe.slice(0, MAX_ROWS), scalp: scalp.slice(0, MAX_ROWS) };
}

/** GeckoTerminal responses (any mix of the source pages) -> the two lists. */
export function buildFeeds(pages: unknown[]): Record<Stage, Token[]> {
  return splitTokens(normalizePools(pages, "agent"));
}
