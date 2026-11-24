import type { Prediction, Token } from "./types";

/* Admission filters.
   A coin / market / agent only appears in a column if it passes that column's
   gate. Pure functions, no React, so they are unit-testable (filters.test.ts).

   Honesty rule: a gate whose input the current data source does not provide is
   reported as SKIPPED — it is never counted as passed. The UI surfaces the
   skipped count instead of pretending those checks ran. */

export type Preset = "strict" | "balanced" | "lenient";
export const PRESETS: Preset[] = ["strict", "balanced", "lenient"];

export interface SnipeGate {
  minLiquidityUsd: number;
  minMarketCapUsd: number;
  minAgeMin: number;
  maxAgeMin: number;
  /* 24h rather than 1h: both the demo data and GeckoTerminal carry it, so the
     gate is enforceable today. */
  minVol24hUsd: number;
  maxAbsChange24hPct: number;
  /* Not provided by GeckoTerminal new_pools. null = rule off for this preset. */
  maxTop10Pct: number | null;
  maxBundlerPct: number | null;
  requireSocial: boolean | null;
}

/* `balanced` holder/bundler/social values are whitepaper Appendix E A-MC8: the
   defaults one trading terminal (Axiom) ships — bundler <=30%, top-10 <=40%,
   social required. Unvalidated, single-source. `strict` and `lenient` are
   proposed calibrations, not sourced. */
export const SNIPE_PRESETS: Record<Preset, SnipeGate> = {
  strict: {
    minLiquidityUsd: 25_000,
    minMarketCapUsd: 50_000,
    minAgeMin: 10,
    maxAgeMin: 180,
    minVol24hUsd: 25_000,
    maxAbsChange24hPct: 1_000,
    maxTop10Pct: 30,
    maxBundlerPct: 20,
    requireSocial: true,
  },
  balanced: {
    minLiquidityUsd: 10_000,
    minMarketCapUsd: 10_000,
    minAgeMin: 5,
    maxAgeMin: 360,
    minVol24hUsd: 5_000,
    maxAbsChange24hPct: 5_000,
    maxTop10Pct: 40,
    maxBundlerPct: 30,
    requireSocial: true,
  },
  lenient: {
    minLiquidityUsd: 3_000,
    minMarketCapUsd: 5_000,
    minAgeMin: 2,
    maxAgeMin: 720,
    minVol24hUsd: 1_000,
    maxAbsChange24hPct: 20_000,
    maxTop10Pct: null,
    maxBundlerPct: null,
    requireSocial: null,
  },
};

export interface GateResult {
  ok: boolean;
  /** rules that ran and the token failed */
  failed: string[];
  /** rules that could not run because the data source lacks the field */
  skipped: string[];
}

export function passesSnipe(t: Token, g: SnipeGate): GateResult {
  const failed: string[] = [];
  const skipped: string[] = [];

  if (t.liquidity < g.minLiquidityUsd) failed.push("liquidity");
  if (t.marketCap < g.minMarketCapUsd) failed.push("market cap");
  if (t.vol24h < g.minVol24hUsd) failed.push("24h volume");
  if (Math.abs(t.changePct) > g.maxAbsChange24hPct) failed.push("24h change");

  if (t.ageMin === undefined) {
    skipped.push("age");
  } else if (t.ageMin < g.minAgeMin || t.ageMin > g.maxAgeMin) {
    failed.push("age");
  }

  if (g.maxTop10Pct !== null) {
    if (t.top10Pct === undefined) skipped.push("top-10 holders");
    else if (t.top10Pct > g.maxTop10Pct) failed.push("top-10 holders");
  }
  if (g.maxBundlerPct !== null) {
    if (t.bundlerPct === undefined) skipped.push("bundlers");
    else if (t.bundlerPct > g.maxBundlerPct) failed.push("bundlers");
  }
  if (g.requireSocial !== null) {
    if (t.hasSocial === undefined) skipped.push("social link");
    else if (g.requireSocial && !t.hasSocial) failed.push("social link");
  }

  return { ok: failed.length === 0, failed, skipped };
}

/* ---------------- agent eligibility ---------------- */

/* Proposed thresholds, to be calibrated. The principle is from the call:
   "if they're brand new, we don't have enough data… I can't attach agents yet"
   and from whitepaper §6 — a rule needs a real sample before it trades. */
export const AGENT_MIN_HISTORY_DAYS = 30;
export const AGENT_MIN_LIQUIDITY_USD = 250_000;
export const AGENT_MIN_VOL24H_USD = 500_000;

/** Whole days of history. Snipe tokens derive it from age; agents from `launched`. */
export function historyDays(t: Token, now: Date = new Date()): number {
  if (t.ageMin !== undefined) return t.ageMin / 1440;
  if (t.launched) {
    const [y, m] = t.launched.split("-").map(Number);
    const ms = now.getTime() - Date.UTC(y, (m || 1) - 1, 1);
    return Math.max(0, ms / 86_400_000);
  }
  return 0;
}

export interface Eligibility {
  eligible: boolean;
  /** shown as the muted tag when not eligible */
  reason: string | null;
}

export function agentEligibility(t: Token, now: Date = new Date()): Eligibility {
  const days = historyDays(t, now);
  if (days < AGENT_MIN_HISTORY_DAYS) {
    const d = days < 1 ? "<1d" : `${Math.floor(days)}d`;
    return { eligible: false, reason: `Manual · ${d} history` };
  }
  if (t.liquidity < AGENT_MIN_LIQUIDITY_USD) {
    return { eligible: false, reason: "Manual · thin liquidity" };
  }
  if (t.vol24h < AGENT_MIN_VOL24H_USD) {
    return { eligible: false, reason: "Manual · low volume" };
  }
  return { eligible: true, reason: null };
}

/* ---------------- prediction gate ---------------- */

/** "12h" | "3d" | "45m" -> hours. Unparseable -> Infinity (never dropped). */
export function closesInHours(closesIn: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([mhd])$/i.exec(closesIn.trim());
  if (!m) return Infinity;
  const n = Number(m[1]);
  return m[2].toLowerCase() === "m" ? n / 60 : m[2].toLowerCase() === "h" ? n : n * 24;
}

export const PRED_MIN_HOURS_LEFT = 1;
export const PRED_MIN_VOTES = 100;

export function passesPrediction(p: Prediction): GateResult {
  const failed: string[] = [];
  if (closesInHours(p.closesIn) < PRED_MIN_HOURS_LEFT) failed.push("closing too soon");
  if (p.votes !== undefined && p.votes < PRED_MIN_VOTES) failed.push("too few votes");
  return { ok: failed.length === 0, failed, skipped: [] };
}
