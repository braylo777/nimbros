import test from "node:test";
import assert from "node:assert/strict";
import { EXIT_TEST_USD, ageRow, depthRow, exitCostPct, flowRow, marketRisk } from "./risk.ts";

const deep = { liquidity: 2_000_000, reserveBase: 1_000_000, reserveQuoteUsd: 1_000_000 };
const thin = { liquidity: 3_000, reserveBase: 2_000, reserveQuoteUsd: 1_000 };

test("exit cost: deep pool is cheap, thin pool is expensive, capped at 100%", () => {
  const a = exitCostPct(EXIT_TEST_USD, 1, { liquidityUsd: deep.liquidity, ...deep })!;
  const b = exitCostPct(EXIT_TEST_USD, 1, { liquidityUsd: thin.liquidity, ...thin })!;
  assert.ok(a.pct < 1);
  assert.ok(b.pct > a.pct);
  assert.ok(b.pct <= 100);
  assert.equal(a.estimated, false);
});
test("exit cost falls back to an estimate without reserves, and refuses nonsense", () => {
  assert.equal(exitCostPct(500, 1, { liquidityUsd: 100_000 })!.estimated, true);
  assert.equal(exitCostPct(500, 0, { liquidityUsd: 100_000 }), null);
  assert.equal(exitCostPct(0, 1, { liquidityUsd: 100_000 }), null);
  assert.equal(exitCostPct(500, 1, { liquidityUsd: 0 }), null);
});
test("liquidity vs market cap grading", () => {
  assert.equal(depthRow(20_000, 100_000).level, "good");
  assert.equal(depthRow(5_000, 100_000).level, "warn");
  assert.equal(depthRow(500, 100_000).level, "bad");
  assert.equal(depthRow(1000, 0).level, "unknown");
  const odd = depthRow(200_000, 100_000); // pool bigger than the reported cap
  assert.equal(odd.level, "unknown");
  assert.equal(odd.value, ">100%");
});
test("age grading and formatting", () => {
  assert.equal(ageRow(30).level, "bad");
  assert.equal(ageRow(30).value, "30m");
  assert.equal(ageRow(60 * 30).level, "warn");
  assert.equal(ageRow(60 * 24 * 30).level, "good");
  assert.equal(ageRow(undefined).level, "unknown");
});
test("flow: thin trade counts warn even when balanced", () => {
  assert.equal(flowRow(5, 5).level, "warn");
  assert.equal(flowRow(300, 300).level, "good");
  assert.equal(flowRow(0, 0).level, "unknown");
  assert.match(flowRow(60, 40).value, /60% buys of 100/);
});
test("summary is driven by the worst row and never invents a verdict", () => {
  const bad = marketRisk({ price: 1, marketCap: 1_000_000, ageMin: 30, buys24h: 3, sells24h: 2, liquidity: thin.liquidity, reserveBase: thin.reserveBase, reserveQuoteUsd: thin.reserveQuoteUsd });
  assert.equal(bad.level, "bad");
  const good = marketRisk({ price: 1, marketCap: 4_000_000, ageMin: 60 * 24 * 90, buys24h: 500, sells24h: 500, liquidity: deep.liquidity, reserveBase: deep.reserveBase, reserveQuoteUsd: deep.reserveQuoteUsd });
  assert.equal(good.level, "good");
  const blank = marketRisk({ price: 0, marketCap: 0, liquidity: 0 });
  assert.equal(blank.level, "unknown");
  assert.equal(blank.rows.length, 4);
});
