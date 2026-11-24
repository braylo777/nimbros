import test from "node:test";
import assert from "node:assert/strict";
import { scale5, RATING_LABEL, ageScore, copycatScore, creatorScore, dayMoveScore, entryScore, exitScore, flowScore, holdersScore, liquidityScore, momentumScore, ratingFor, sellScore, socialScore, tapeScore, trendScore, turnoverScore, volumeTrendScore, MIN_COVERAGE } from "./score.ts";
import type { Candle, PoolTrade } from "./pool.ts";

const deep = { liquidityUsd: 200_000, reserveBase: 100_000, reserveQuoteUsd: 100_000 };

test("depth scores on a log curve: dust is near zero, a real pool is high, huge stops mattering", () => {
  assert.equal(liquidityScore(1_000), 0);
  const mid = liquidityScore(25_000)!;
  assert.ok(mid > 45 && mid < 70, `25k scored ${mid}`);
  assert.equal(liquidityScore(250_000), 100);
  assert.equal(liquidityScore(5_000_000), 100); // capped, not runaway
});

test("depth is unknown rather than zero when there is no figure", () => {
  assert.equal(liquidityScore(undefined), null);
  assert.equal(liquidityScore(0), null);
  assert.equal(liquidityScore(-5), null);
});

test("turnover rewards a healthy band and penalises both dead and frantic pools", () => {
  assert.equal(turnoverScore(0, 100_000), 0);        // no trading
  assert.equal(turnoverScore(50_000, 100_000), 100); // 0.5x — bottom of the band
  assert.equal(turnoverScore(300_000, 100_000), 100); // 6x — top of the band
  const frantic = turnoverScore(3_000_000, 100_000)!; // 30x — farmed
  assert.ok(frantic <= 0, `30x scored ${frantic}`);
  assert.ok(turnoverScore(1_800_000, 100_000)! < 100); // 18x is fading
});

test("turnover needs both numbers, and a zero-liquidity pool is unknown not infinite", () => {
  assert.equal(turnoverScore(undefined, 100), null);
  assert.equal(turnoverScore(100, undefined), null);
  assert.equal(turnoverScore(100, 0), null);
});

test("buy flow peaks on genuine buy pressure, not on totally one-sided prints", () => {
  assert.equal(flowScore(0, 100), 0);
  assert.equal(flowScore(50, 50), 60);              // balanced
  const good = flowScore(70, 30)!;                   // 70% buys
  assert.ok(good > 85 && good <= 100, `70% scored ${good}`);
  assert.ok(flowScore(100, 0)! < good);              // 100% buys scores below a healthy 70%
});

test("buy flow is unknown when the counts aren't reported", () => {
  assert.equal(flowScore(undefined, 10), null);
  assert.equal(flowScore(10, undefined), null);
  assert.equal(flowScore(0, 0), null);
});

test("exit cost: cheap to get out scores high, a trap scores zero", () => {
  const cheap = exitScore(1, deep)!;
  assert.ok(cheap > 80, `deep pool scored ${cheap}`);
  const thin = exitScore(1, { liquidityUsd: 1_200, reserveBase: undefined, reserveQuoteUsd: undefined })!;
  assert.ok(thin < 30, `thin pool scored ${thin}`);
  assert.equal(exitScore(0, deep), null); // no price, no answer
});

test("public links are a real but small signal, and silence is scored low, not unknown", () => {
  assert.equal(socialScore(true), 100);
  assert.equal(socialScore(false), 20);
  assert.equal(socialScore(undefined), null); // never checked is different from checked-and-none
});

const bars = (closes: number[], v = 100): Candle[] => closes.map((c, i) => ({ t: i, o: c, h: c * 1.01, l: c * 0.99, c, v }));
const trades = (n: number, side: "buy" | "sell"): PoolTrade[] => Array.from({ length: n }, (_, i) => ({ t: i, side, price: 1, size: 1, usd: 100, tx: String(i) }));

test("a healthy, fully-measured coin rates 5 (buy) with full coverage", () => {
  const r = entryScore({
    price: 1, liquidity: 200_000, vol24h: 400_000, buys24h: 700, sells24h: 300, hasSocial: true, depth: deep,
    candles: bars([1, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 1.09, 1.1]), trades: [...trades(8, "buy"), ...trades(2, "sell")],
    ageMin: 3000, changePct: 12, holders: { top10Pct: 18, creatorPct: 0 }, copycats: { newer: 0, isCopy: false }, sell: "ok",
  });
  assert.equal(r.coverage > 0.9, true);
  assert.equal(r.grade, "strong");
  assert.equal(r.rating, 5);
  assert.equal(RATING_LABEL[r.rating!], "Buy");
});

test("a dust coin with no links rates 1 (sell) or 2 (hold), never buy", () => {
  const thin = { liquidityUsd: 1_100, reserveBase: undefined, reserveQuoteUsd: undefined };
  const r = entryScore({ price: 1, liquidity: 1_100, vol24h: 50, buys24h: 2, sells24h: 40, hasSocial: false, depth: thin, ageMin: 5, changePct: -60, candles: bars([1.3, 1.2, 1.1, 1, 0.9, 0.8, 0.7, 0.6]), holders: { top10Pct: 85, creatorPct: 40 } });
  assert.equal(r.grade, "weak");
  assert.ok(r.rating !== null && r.rating <= 2, `rated ${r.rating}`);
});

test("too little data yields no score and no rating, rather than a misleadingly average one", () => {
  const r = entryScore({ price: 0 });
  assert.equal(r.score, null);
  assert.equal(r.rating, null);
  assert.equal(r.grade, "unknown");
  assert.ok(r.coverage < MIN_COVERAGE);
});

test("missing factors are excluded from the average instead of counting as neutral", () => {
  const partial = entryScore({ price: 1, liquidity: 200_000, vol24h: 400_000, buys24h: 700, sells24h: 300, depth: deep, ageMin: 3000, changePct: 10, hasSocial: true, holders: { top10Pct: 25 } });
  assert.ok(partial.coverage < 1 && partial.coverage >= MIN_COVERAGE);
  const known = partial.factors.filter((f) => f.score !== null);
  const expected = Math.round(known.reduce((s, f) => s + f.score! * f.weight, 0) / known.reduce((s, f) => s + f.weight, 0));
  assert.equal(partial.score, expected);
  assert.equal(partial.factors.find((f) => f.key === "sell")!.score, null);
});

test("the weights cover every factor exactly once and sum to 100", () => {
  const r = entryScore({ price: 1, liquidity: 10_000, depth: deep });
  const keys = r.factors.map((f) => f.key).sort();
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, 16);
  assert.equal(r.factors.reduce((s, f) => s + f.weight, 0), 100);
});

test("every factor score is a whole number, decimals here would be false precision", () => {
  const r = entryScore({ price: 1, liquidity: 10_412, vol24h: 6_333, buys24h: 772, sells24h: 498, hasSocial: true, candles: bars([1, 1.02, 0.99, 1.03, 1.01, 1.04, 1.02, 1.05]),
    depth: { liquidityUsd: 10_412, reserveBase: 5_000, reserveQuoteUsd: 5_200 } });
  for (const f of r.factors) if (f.score !== null) assert.equal(f.score, Math.round(f.score), `${f.key} = ${f.score}`);
  assert.ok(r.score !== null && r.score === Math.round(r.score));
});

test("rating thresholds: 1 sell, 2 hold, 3 wait, 4 watch, 5 buy", () => {
  assert.deepEqual([10, 40, 50, 60, 80].map(ratingFor), [1, 2, 3, 4, 5]);
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => RATING_LABEL[n as 1]), ["Sell", "Hold", "Wait", "Watch", "Buy"]);
});

test("a blocked or skimmed sale forces a 1 whatever else looks good, and says why", () => {
  const good = { price: 1, liquidity: 200_000, vol24h: 400_000, buys24h: 700, sells24h: 300, hasSocial: true, depth: deep, ageMin: 3000, changePct: 10 };
  for (const sell of ["blocked", "taxed"] as const) {
    const r = entryScore({ ...good, sell });
    assert.equal(r.rating, 1);
    assert.ok(r.veto);
  }
});

test("a punishing exit cost caps the rating at 2", () => {
  const shallow = { liquidityUsd: 2_000, reserveBase: 1000, reserveQuoteUsd: 1000 };
  const r = entryScore({ price: 1, liquidity: 2_000, vol24h: 3_000, buys24h: 900, sells24h: 100, hasSocial: true, depth: shallow, ageMin: 3000, changePct: 10, holders: { top10Pct: 15 }, sell: "ok" });
  assert.ok(r.rating !== null && r.rating <= 2);
});

test("price-action factors read the candles", () => {
  assert.equal(momentumScore(bars([1, 1, 1])), null);
  assert.ok(momentumScore(bars([1, 1, 1, 1, 1, 1, 1.1]))!.score === 100);
  assert.ok(momentumScore(bars([1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1]))!.score < 10);
  assert.ok(trendScore(bars([1, 1, 1, 1, 1, 1, 1, 1, 1, 1.2]))!.score > 60);
  assert.equal(volumeTrendScore(bars([1, 1, 1, 1, 1, 1]))!.score, 60);
  assert.equal(tapeScore(trades(3, "buy")), null);
  assert.ok(tapeScore(trades(20, "buy"))!.score < 70); // all-buy prints are one bot, not demand
});

test("age, holders, creator, copycat and 24h-move factors", () => {
  assert.ok(ageScore(5)! < ageScore(2000)!);
  assert.equal(holdersScore(20), 100);
  assert.equal(holdersScore(80), 0);
  assert.equal(creatorScore(0), 100);
  assert.equal(creatorScore(30), 0);
  assert.equal(copycatScore(0, false), 100);
  assert.ok(copycatScore(0, true)! <= 15);
  assert.equal(copycatScore(undefined, false), null);
  assert.ok(dayMoveScore(300)! < dayMoveScore(30)!);
  assert.ok(dayMoveScore(-60)! < dayMoveScore(-5)!);
  assert.equal(sellScore("ok"), 100);
  assert.equal(sellScore(null), null);
});

test("scale5 maps 0-100 onto 1-5", () => {
  assert.deepEqual([0, 20, 21, 40, 41, 60, 61, 80, 81, 100].map(scale5), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
});
