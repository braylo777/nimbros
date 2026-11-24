export interface Prediction {
  id: string;
  headline: string;
  source: string;
  date: string;
  closesIn: string;
  yesPct: number;
  votes?: number;
  volume: number;
  /** live feed only */
  image?: string;
  url?: string;
  liquidity?: number;
  vol24h?: number;
  dayChange?: number;
}

/** Market stats shared by agent tokens and snipe tokens, so either can open Trade. */
export interface MarketStats {
  price: number;
  changePct: number;
  /** 1-hour price change, when the source provides it (GeckoTerminal does); undefined means unknown, never guessed as 0 */
  changePct1h?: number;
  marketCap: number;
  liquidity: number;
  vol24h: number;
  holders?: number;
  txns: number;
  ath?: number;
  atl?: number;
  supply?: number;
  contract: string;
  winRate?: number;
  nimbusScore?: number;
  execPct?: number;
  drawdownPct?: number;
}

export interface Token extends MarketStats {
  id: string;
  kind: "agent" | "snipe";
  name: string;
  ticker: string;
  /** Agent tokens carry the NimBros badge; snipe tokens do not. */
  pegged?: string;
  strategy?: string;
  /** snipe-only */
  ageMin?: number;
  bondedPct?: number;
  /** agent tokens: approximate launch month of the pegged coin, "YYYY-MM" (illustrative) */
  launched?: string;
  /**
   * Fields a real feed may or may not provide. `undefined` means "this source
   * doesn't have it" and the filter reports it as skipped — never as passed.
   * GeckoTerminal's new_pools carries none of these three.
   */
  top10Pct?: number;
  bundlerPct?: number;
  hasSocial?: boolean;
  /** the project's own links (DexScreener `info`), https-only. Empty array = checked, found none. */
  socials?: { type: string; url: string }[];
  /** live feed only */
  live?: boolean;
  logo?: string;
  dex?: string;
  poolUrl?: string;
  buys24h?: number;
  sells24h?: number;
  /** real pool reserves (DexScreener) — base tokens held, and USD depth on the other side */
  reserveBase?: number;
  reserveQuoteUsd?: number;
}
