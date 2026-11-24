import { test } from "node:test";
import assert from "node:assert/strict";
import type { Token, Prediction } from "./types";
import {
  PRESETS,
  SNIPE_PRESETS,
  agentEligibility,
  closesInHours,
  historyDays,
  passesPrediction,
  passesSnipe,
} from "./filters.ts";

/* Run:  node --test lib/filters.test.ts   (Node 24 strips types natively) */

const base: Token = {
  id: "x",
  kind: "snipe",
  name: "X",
  ticker: "X",
  price: 0.01,
  changePct: 10,
  marketCap: 300_000,
  liquidity: 40_000,
  vol24h: 200_000,
  holders: 500,
  txns: 1000,
  ath: 0.02,
  atl: 0.001,
  supply: 1_000_000,
  contract: "0x0",
  winRate: 50,
  nimbusScore: 50,
  execPct: 90,
  drawdownPct: -10,
  ageMin: 30,
};

/* Two real pools observed on the live Solana feed (GeckoTerminal new_pools,
   2026-09-18). They are exactly why the gates exist. */
const dustPool: Token = {
  ...base,
  id: "nnoli",
  marketCap: 203, // FDV $203.43
  liquidity: 210, // reserve $210.87
  vol24h: 0.008, // 24h volume $0.008
  changePct: 0,
  ageMin: 8,
};
const absurdGainPool: Token = {
  ...base,
  id: "babycorn",
  marketCap: 269_448, // FDV $269,448
  liquidity: 20_895, // reserve $20,895
  vol24h: 27_111,
  changePct: 67_689, // +67,689% 24h — a pool that just seeded, not a real move
  ageMin: 45,
};

test("dust pool fails every preset", () => {
  for (const p of PRESETS) {
    const r = passesSnipe(dustPool, SNIPE_PRESETS[p]);
    assert.equal(r.ok, false, `${p} should reject the $203-FDV pool`);
    assert.ok(r.failed.includes("liquidity"));
  }
});

test("+67,689% pool fails every preset on 24h change", () => {
  for (const p of PRESETS) {
    const r = passesSnipe(absurdGainPool, SNIPE_PRESETS[p]);
    assert.equal(r.ok, false, `${p} should reject the absurd-gain pool`);
    assert.ok(r.failed.includes("24h change"));
  }
});

test("a healthy pool passes balanced", () => {
  const r = passesSnipe(base, SNIPE_PRESETS.balanced);
  assert.equal(r.ok, true);
  assert.deepEqual(r.failed, []);
});

test("fields the source lacks are SKIPPED, never counted as passed", () => {
  // base has no top10Pct / bundlerPct / hasSocial, like GeckoTerminal data
  const r = passesSnipe(base, SNIPE_PRESETS.balanced);
  assert.deepEqual(r.skipped.sort(), ["bundlers", "social link", "top-10 holders"]);
  // lenient turns those rules off, so nothing is skipped
  assert.deepEqual(passesSnipe(base, SNIPE_PRESETS.lenient).skipped, []);
});

test("when the field IS present the rule really runs", () => {
  const loud = { ...base, top10Pct: 80, bundlerPct: 5, hasSocial: true };
  const r = passesSnipe(loud, SNIPE_PRESETS.balanced);
  assert.equal(r.ok, false);
  assert.deepEqual(r.failed, ["top-10 holders"]);
  const noSocial = { ...base, top10Pct: 10, bundlerPct: 5, hasSocial: false };
  assert.deepEqual(passesSnipe(noSocial, SNIPE_PRESETS.balanced).failed, ["social link"]);
});

test("presets are ordered strict >= balanced >= lenient", () => {
  const s = SNIPE_PRESETS.strict, b = SNIPE_PRESETS.balanced, l = SNIPE_PRESETS.lenient;
  assert.ok(s.minLiquidityUsd >= b.minLiquidityUsd && b.minLiquidityUsd >= l.minLiquidityUsd);
  assert.ok(s.minMarketCapUsd >= b.minMarketCapUsd && b.minMarketCapUsd >= l.minMarketCapUsd);
  assert.ok(s.maxAbsChange24hPct <= b.maxAbsChange24hPct && b.maxAbsChange24hPct <= l.maxAbsChange24hPct);
});

test("a 12-minute-old coin is never agent-eligible", () => {
  const fresh = { ...base, ageMin: 12, liquidity: 5_000_000, vol24h: 9_000_000 };
  const e = agentEligibility(fresh);
  assert.equal(e.eligible, false);
  assert.equal(e.reason, "Manual · <1d history");
});

test("an aged, liquid coin is eligible; thin liquidity or volume is not", () => {
  const aged: Token = {
    ...base,
    kind: "agent",
    ageMin: undefined,
    launched: "2024-10",
    liquidity: 1_000_000,
    vol24h: 2_000_000,
  };
  const now = new Date("2026-09-18T00:00:00Z");
  assert.equal(agentEligibility(aged, now).eligible, true);
  assert.equal(agentEligibility({ ...aged, liquidity: 100_000 }, now).reason, "Manual · thin liquidity");
  assert.equal(agentEligibility({ ...aged, vol24h: 100_000 }, now).reason, "Manual · low volume");
});

test("history gate: a month-old launch is eligible, a 17-day-old one is not", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  const mk = (launched: string): Token => ({
    ...base, kind: "agent", ageMin: undefined, launched,
    liquidity: 1_000_000, vol24h: 2_000_000,
  });
  // "2026-08" is 48 days before `now` -> eligible; "2026-09" is 17 days -> not
  assert.ok(historyDays(mk("2026-08"), now) > 30);
  assert.equal(agentEligibility(mk("2026-08"), now).eligible, true);
  assert.equal(agentEligibility(mk("2026-09"), now).eligible, false);
});

test("closesInHours parses m/h/d and never drops an unparseable value", () => {
  assert.equal(closesInHours("45m"), 0.75);
  assert.equal(closesInHours("12h"), 12);
  assert.equal(closesInHours("3d"), 72);
  assert.equal(closesInHours("soon"), Infinity);
});

test("prediction gate drops closing-soon and low-vote markets", () => {
  const p: Prediction = {
    id: "p", headline: "h", source: "s", date: "d",
    closesIn: "12h", yesPct: 50, votes: 500, volume: 1,
  };
  assert.equal(passesPrediction(p).ok, true);
  assert.deepEqual(passesPrediction({ ...p, closesIn: "30m" }).failed, ["closing too soon"]);
  assert.deepEqual(passesPrediction({ ...p, votes: 40 }).failed, ["too few votes"]);
});
