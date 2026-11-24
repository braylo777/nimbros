import { exitCostPct } from "./risk.ts";
import type { Depth } from "./depth.ts";
import type { Candle, PoolTrade } from "./pool.ts";

/* The entry score: one number for "how tradable does this look right now", built only from data we
   actually have. PURE.

   It is deliberately NOT called a probability. It is a weighted read of live microstructure, not a
   forecast, and it says so. Factors we can't measure for a given coin are reported as not covered
   rather than scored as neutral — a coin with no data should look unknown, not average.

   Holder concentration and social reach are the two inputs we do not have a per-wallet source for on Solana; when
   one arrives it slots in as another factor without changing how the score is read. */

export type FactorKey =
  | "liquidity" | "exit" | "flow" | "turnover" | "social"
  | "momentum" | "trend" | "volatility" | "volumeTrend" | "tape" | "age" | "dayMove"
  | "holders" | "creator" | "copycat" | "sell";

export type Group = "Pool" | "Price action" | "Order flow" | "Holders & safety";

export interface Factor {
  key: FactorKey;
  label: string;
  group: Group;
  /** 0-100, or null when the data needed isn't available */
  score: number | null;
  weight: number;
  /** the reading behind the score, e.g. "+4.2% over 6 bars" */
  reading?: string;
  note: string;
}

/** 1 sell, 2 hold, 3 wait, 4 watch, 5 buy */
export type Rating = 1 | 2 | 3 | 4 | 5;
export const RATING_LABEL: Record<Rating, string> = { 1: "Sell", 2: "Hold", 3: "Wait", 4: "Watch", 5: "Buy" };

export interface EntryScore {
  /** 0-100 over the factors that could be measured, or null when too little is known */
  score: number | null;
  /** the 1-5 call, or null when too little is known */
  rating: Rating | null;
  /** why the rating was capped below what the composite alone would give, if it was */
  veto?: string;
  /** share of total weight that was actually measurable, 0-1 */
  coverage: number;
  grade: "strong" | "fair" | "weak" | "unknown";
  factors: Factor[];
}

const WEIGHTS: Record<FactorKey, number> = {
  liquidity: 10, exit: 12, flow: 8, turnover: 6, social: 4,
  momentum: 9, trend: 7, volatility: 5, volumeTrend: 5, tape: 6, age: 4, dayMove: 3,
  holders: 8, creator: 4, copycat: 3, sell: 6,
};

/** Below this share of measurable inputs, we refuse to publish a number at all. */
export const MIN_COVERAGE = 0.5;

/** Every factor is a whole number 0-100: these are rough reads, and decimals would be false precision. */
const clamp = (n: number) => Math.round(Math.max(0, Math.min(100, n)));

/** Deeper pools score higher, on a log curve: $1K is dust, $25K is real, past ~$250K it stops mattering. */
export function liquidityScore(usd: number | undefined): number | null {
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return null;
  const lo = Math.log10(1_000), hi = Math.log10(250_000);
  return clamp(((Math.log10(usd) - lo) / (hi - lo)) * 100);
}

/** Volume against depth. Some churn is life; 50x a day is a pool being farmed, not traded. */
export function turnoverScore(vol24h: number | undefined, liquidity: number | undefined): number | null {
  if (vol24h === undefined || liquidity === undefined || !(liquidity > 0) || !Number.isFinite(vol24h) || vol24h < 0) return null;
  const t = vol24h / liquidity;
  if (t >= 0.5 && t <= 6) return 100;        // healthy band
  if (t < 0.5) return clamp((t / 0.5) * 100); // too quiet
  return clamp(100 - ((t - 6) / 24) * 100);   // frantic: fades out by ~30x
}

/** Share of trades that were buys. 50/50 is neutral; heavy one-sidedness in either direction is noise. */
export function flowScore(buys: number | undefined, sells: number | undefined): number | null {
  if (buys === undefined || sells === undefined) return null;
  const n = buys + sells;
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = (buys / n) * 100;
  // reward buy-heavy flow, but stop rewarding past ~75% (that's usually one bot, not demand)
  if (pct <= 50) return clamp((pct / 50) * 60);
  if (pct <= 75) return clamp(60 + ((pct - 50) / 25) * 40);
  return clamp(100 - ((pct - 75) / 25) * 35);
}

/** Cheap to get out of = good. Over ~10% to exit $500 is a trap. */
export function exitScore(price: number, depth: Depth): number | null {
  const e = exitCostPct(500, price, depth);
  if (!e) return null;
  return clamp(100 - (e.pct / 10) * 100);
}

/** A project with public links is not safe, but a project with none is a specific kind of risk. */
export function socialScore(hasSocial: boolean | undefined): number | null {
  if (hasSocial === undefined) return null;
  return hasSocial ? 100 : 20;
}

const pctChange = (a: number, b: number) => (a > 0 ? ((b - a) / a) * 100 : 0);

/** Price change over the last ~6 bars. Up 10% = 100, down 10% = 0. */
export function momentumScore(candles: Candle[] | undefined): { score: number; reading: string } | null {
  if (!candles || candles.length < 6) return null;
  const c = candles.slice(-7);
  const chg = pctChange(c[0].c, c[c.length - 1].c);
  return { score: clamp(50 + chg * 5), reading: `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% over ${c.length - 1} bars` };
}

/** Price against its 20-bar average. Above is healthier; the score saturates at +5%. */
export function trendScore(candles: Candle[] | undefined): { score: number; reading: string } | null {
  if (!candles || candles.length < 10) return null;
  const c = candles.slice(-20);
  const sma = c.reduce((s, x) => s + x.c, 0) / c.length;
  const dev = pctChange(sma, c[c.length - 1].c);
  return { score: clamp(50 + dev * 10), reading: `${dev >= 0 ? "+" : ""}${dev.toFixed(1)}% vs ${c.length}-bar avg` };
}

/** Average bar range. Calm entries score high; 10%+ swings per bar are a coin flip. */
export function volatilityScore(candles: Candle[] | undefined): { score: number; reading: string } | null {
  if (!candles || candles.length < 6) return null;
  const c = candles.slice(-20).filter((x) => x.c > 0);
  if (c.length < 6) return null;
  const avg = (c.reduce((s, x) => s + (x.h - x.l) / x.c, 0) / c.length) * 100;
  return { score: clamp(100 - (avg - 1) * (100 / 9)), reading: `${avg.toFixed(1)}% avg bar range` };
}

/** Is volume picking up? Last 3 bars against the 3 before. */
export function volumeTrendScore(candles: Candle[] | undefined): { score: number; reading: string } | null {
  if (!candles || candles.length < 6) return null;
  const rec = candles.slice(-3).reduce((s, x) => s + x.v, 0);
  const prev = candles.slice(-6, -3).reduce((s, x) => s + x.v, 0);
  if (!(prev > 0)) return null;
  const r = rec / prev;
  const score = r >= 1 ? clamp(60 + (Math.min(r, 2) - 1) * 40) : clamp(r * 60);
  return { score, reading: `${r.toFixed(2)}x the prior 3 bars` };
}

/** Who is trading right now: dollar-weighted buy share of the latest prints. */
export function tapeScore(trades: PoolTrade[] | undefined): { score: number; reading: string } | null {
  if (!trades || trades.length < 8) return null;
  const t = trades.slice(0, 30);
  const buy = t.filter((x) => x.side === "buy").reduce((s, x) => s + x.usd, 0);
  const sell = t.filter((x) => x.side === "sell").reduce((s, x) => s + x.usd, 0);
  const sc = flowScore(buy, sell);
  if (sc === null) return null;
  return { score: sc, reading: `${Math.round((buy / (buy + sell)) * 100)}% buys by value, last ${t.length}` };
}

/** Newborn pools are the riskiest; a pool that has survived a day has been tested. */
export function ageScore(ageMin: number | undefined): number | null {
  if (ageMin === undefined || !Number.isFinite(ageMin) || ageMin < 0) return null;
  if (ageMin < 10) return 10;
  if (ageMin < 60) return 30;
  if (ageMin < 360) return 55;
  if (ageMin < 1440) return 75;
  return 100;
}

/** Overextension: a healthy rise is fine, a 3x day is late, a -50% day is a falling knife. */
export function dayMoveScore(changePct: number | undefined): number | null {
  if (changePct === undefined || !Number.isFinite(changePct)) return null;
  if (changePct >= 0) return changePct <= 60 ? 100 : clamp(100 - (changePct - 60) * (90 / 140));
  return changePct >= -10 ? 90 : clamp(90 + (changePct + 10) * 2);
}

/** Top-10 concentration: 20% or less is spread out, 80% or more is a few hands. */
export function holdersScore(top10Pct: number | undefined): number | null {
  if (top10Pct === undefined || !Number.isFinite(top10Pct)) return null;
  return clamp(100 - (top10Pct - 20) * (100 / 60));
}

/** Creator still holding: none is clean, 30% or more is a dump waiting. */
export function creatorScore(pct: number | undefined): number | null {
  if (pct === undefined || !Number.isFinite(pct)) return null;
  return clamp(100 - pct * (100 / 30));
}

/** Same-name coins: newer copies siphon volume, and being the copy is worse. */
export function copycatScore(newer: number | undefined, isCopy: boolean | undefined): number | null {
  if (newer === undefined) return null;
  const base = newer === 0 ? 100 : newer === 1 ? 60 : newer === 2 ? 35 : 10;
  return isCopy ? Math.min(base, 15) : base;
}

export type SellCheck = "ok" | "taxed" | "blocked" | null;
/** The dry-run sale by a real holder. */
export function sellScore(v: SellCheck | undefined): number | null {
  if (!v) return null;
  return v === "ok" ? 100 : v === "taxed" ? 10 : 0;
}

export interface ScoreInput {
  price: number;
  liquidity?: number;
  vol24h?: number;
  buys24h?: number;
  sells24h?: number;
  hasSocial?: boolean;
  depth?: Depth;
  candles?: Candle[];
  trades?: PoolTrade[];
  ageMin?: number;
  changePct?: number;
  holders?: { top10Pct: number; creatorPct?: number };
  copycats?: { newer: number; isCopy: boolean };
  sell?: SellCheck;
}

/** Composite thresholds for the 1-5 call. */
export function ratingFor(score: number): Rating {
  return score >= 72 ? 5 : score >= 58 ? 4 : score >= 45 ? 3 : score >= 32 ? 2 : 1;
}

export function entryScore(t: ScoreInput): EntryScore {
  const depth: Depth = t.depth ?? { liquidityUsd: t.liquidity ?? 0, reserveBase: undefined, reserveQuoteUsd: undefined };
  const mo = momentumScore(t.candles), tr = trendScore(t.candles), vo = volatilityScore(t.candles), vt = volumeTrendScore(t.candles), tp = tapeScore(t.trades);
  const ex = exitCostPct(500, t.price, depth);
  const F = (key: FactorKey, label: string, group: Group, score: number | null, note: string, reading?: string): Factor => ({ key, label, group, weight: WEIGHTS[key], score, note, reading });
  const factors: Factor[] = [
    F("liquidity", "Depth", "Pool", liquidityScore(t.liquidity), "How much is actually in the pool.", t.liquidity ? `$${Math.round(t.liquidity).toLocaleString("en-US")} in the pool` : undefined),
    F("exit", "Exit cost", "Pool", exitScore(t.price, depth), "Price impact to sell $500 back out.", ex ? `${ex.pct.toFixed(1)}% to sell $500` : undefined),
    F("turnover", "Turnover", "Pool", turnoverScore(t.vol24h, t.liquidity), "24h volume against pool depth.", t.liquidity && t.vol24h !== undefined ? `${(t.vol24h / t.liquidity).toFixed(1)}x depth a day` : undefined),
    F("age", "Pool age", "Pool", ageScore(t.ageMin), "Newborn pools are the riskiest.", t.ageMin !== undefined ? (t.ageMin < 60 ? `${Math.round(t.ageMin)}m old` : t.ageMin < 1440 ? `${Math.round(t.ageMin / 60)}h old` : `${Math.round(t.ageMin / 1440)}d old`) : undefined),
    F("momentum", "Momentum", "Price action", mo?.score ?? null, "Price change over the last few bars.", mo?.reading),
    F("trend", "Trend", "Price action", tr?.score ?? null, "Price against its recent average.", tr?.reading),
    F("volatility", "Volatility", "Price action", vo?.score ?? null, "Average bar range; calmer is easier to enter.", vo?.reading),
    F("dayMove", "24h move", "Price action", dayMoveScore(t.changePct), "Overextended rises and falling knives score low.", t.changePct !== undefined ? `${t.changePct >= 0 ? "+" : ""}${t.changePct.toFixed(1)}% in 24h` : undefined),
    F("flow", "Buy flow", "Order flow", flowScore(t.buys24h, t.sells24h), "Share of 24h trades that were buys.", t.buys24h !== undefined && t.sells24h !== undefined ? `${t.buys24h} buys / ${t.sells24h} sells` : undefined),
    F("tape", "Live tape", "Order flow", tp?.score ?? null, "Who is trading right now, by value.", tp?.reading),
    F("volumeTrend", "Volume trend", "Order flow", vt?.score ?? null, "Is volume picking up or fading.", vt?.reading),
    F("holders", "Concentration", "Holders & safety", holdersScore(t.holders?.top10Pct), "How much the top 10 wallets hold.", t.holders ? `top 10 hold ${t.holders.top10Pct.toFixed(1)}%` : undefined),
    F("creator", "Creator holds", "Holders & safety", creatorScore(t.holders ? (t.holders.creatorPct ?? 0) : undefined), "Supply still with the wallet that made the coin.", t.holders ? `${(t.holders.creatorPct ?? 0).toFixed(1)}%` : undefined),
    F("sell", "Sell test", "Holders & safety", sellScore(t.sell), "A real holder's dry-run sale: does it go through, and at what payout.", t.sell ? (t.sell === "ok" ? "sale went through" : t.sell === "taxed" ? "sale skimmed" : "sale reverted") : undefined),
    F("copycat", "Copycats", "Holders & safety", copycatScore(t.copycats?.newer, t.copycats?.isCopy), "Same-name coins pulling volume away.", t.copycats ? (t.copycats.isCopy ? "an older, deeper coin exists" : `${t.copycats.newer} newer copies`) : undefined),
    F("social", "Public links", "Holders & safety", socialScore(t.hasSocial), "Whether the project publishes any links."),
  ];

  const known = factors.filter((f) => f.score !== null);
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const knownWeight = known.reduce((s, f) => s + f.weight, 0);
  const coverage = totalWeight > 0 ? knownWeight / totalWeight : 0;

  if (coverage < MIN_COVERAGE || knownWeight === 0) return { score: null, rating: null, coverage, grade: "unknown", factors };

  const score = Math.round(known.reduce((s, f) => s + (f.score as number) * f.weight, 0) / knownWeight);
  let rating = ratingFor(score);
  let veto: string | undefined;
  if (t.sell === "blocked" || t.sell === "taxed") {
    rating = 1;
    veto = t.sell === "blocked" ? "A holder's test sale reverted: sells may be blocked." : "A holder's test sale was skimmed: something takes a cut of every sale.";
  } else if (ex && ex.pct >= 25 && rating > 2) {
    rating = 2;
    veto = `Selling $500 would cost ${ex.pct.toFixed(0)}% of its value.`;
  }
  const grade = rating >= 4 ? "strong" : rating === 3 ? "fair" : "weak";
  return { score, rating, veto, coverage, grade, factors };
}

/** A 0-100 factor score on the 1-5 scale used everywhere in the UI (1 worst, 5 best). */
export const scale5 = (n: number): 1 | 2 | 3 | 4 | 5 => (n <= 20 ? 1 : n <= 40 ? 2 : n <= 60 ? 3 : n <= 80 ? 4 : 5);
