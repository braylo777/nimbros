import test from "node:test";
import assert from "node:assert/strict";
import { sellImpact } from "./depth.ts";

test("with reserves, sell impact uses qty/(reserve+qty) and is capped by the curve", () => {
  const d = { liquidityUsd: 100_000, reserveBase: 50_000, reserveQuoteUsd: 50_000 };
  const r = sellImpact(1_000, 1, d);
  assert.equal(r.model, "pool");
  assert.ok(Math.abs(r.impact - 1_000 / 51_000) < 1e-12);
  // approaching the whole reserve pushes impact toward 1, never past it
  const huge = sellImpact(10_000_000, 1, d);
  assert.ok(huge.impact > 0.99 && huge.impact < 1);
});

test("no reserves -> estimate model, using the flat 2x/liquidity formula", () => {
  const d = { liquidityUsd: 100_000 };
  const r = sellImpact(500, 2, d); // 500 qty * $2 = $1,000 gross
  assert.equal(r.model, "estimate");
  assert.ok(Math.abs(r.impact - (2 * 1_000) / 100_000) < 1e-12);
});

test("zero liquidity with no reserves is an infinite (refuse-worthy) impact, never a false zero", () => {
  const r = sellImpact(500, 2, { liquidityUsd: 0 });
  assert.equal(r.impact, Infinity);
});

test("deeper pools always cost less to exit than shallower ones for the same order", () => {
  const deep = sellImpact(1_000, 1, { liquidityUsd: 1_000_000, reserveBase: 500_000, reserveQuoteUsd: 500_000 });
  const shallow = sellImpact(1_000, 1, { liquidityUsd: 10_000, reserveBase: 5_000, reserveQuoteUsd: 5_000 });
  assert.ok(deep.impact < shallow.impact);
});
