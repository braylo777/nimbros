import test from "node:test";
import assert from "node:assert/strict";
import { feeOn, splitFee, SPLIT_BPS, sumSplit } from "./feeSplit.ts";
import { FEE_BPS } from "./realPolicy.ts";

test("the published rates are the ones in the pitch: 15 bps spot, 4 copy, 3 perp", () => {
  assert.deepEqual({ ...FEE_BPS }, { spot: 15, copy: 4, perp: 3 });
});

test("the split percentages add up to exactly 100%", () => {
  assert.equal(Object.values(SPLIT_BPS).reduce((a, b) => a + b, 0), 10_000);
});

test("a clean amount splits into the published percentages", () => {
  const s = splitFee(1_000_000n);
  assert.deepEqual(s, { buyback: 400_000n, insurance: 300_000n, treasury: 150_000n, builders: 100_000n, solana: 50_000n });
  assert.equal(sumSplit(s), 1_000_000n);
});

test("nothing is ever lost to rounding: the parts always sum back to the whole", () => {
  for (const total of [1n, 2n, 7n, 99n, 12_345n, 999_999_999_999n, 10n ** 24n]) {
    assert.equal(sumSplit(splitFee(total)), total, `total ${total}`);
  }
});

test("the rounding remainder lands in buyback, and every other bucket rounds down", () => {
  const s = splitFee(7n); // 30%/15%/10%/5% of 7 all floor to 0 or 1
  assert.equal(s.insurance, 2n); // 2.1 -> 2
  assert.equal(s.treasury, 1n);  // 1.05 -> 1
  assert.equal(s.builders, 0n);  // 0.7 -> 0
  assert.equal(s.solana, 0n);       // 0.35 -> 0
  assert.equal(s.buyback, 4n);   // 7 - 3 = 4, keeps the sum exact
});

test("zero and negative totals split into nothing rather than throwing", () => {
  assert.equal(sumSplit(splitFee(0n)), 0n);
  assert.equal(sumSplit(splitFee(-5n)), 0n);
});

test("feeOn charges the rate and always floors, so we never overcharge", () => {
  assert.equal(feeOn(1_000_000n, FEE_BPS.spot), 1_500n); // 15 bps of 1e6
  assert.equal(feeOn(1_000_000n, FEE_BPS.copy), 400n);
  assert.equal(feeOn(1_000_000n, FEE_BPS.perp), 300n);
  assert.equal(feeOn(999n, 15), 1n); // 1.4985 floors to 1
  assert.equal(feeOn(1n, 15), 0n); // dust rounds to no fee, never up
});

test("feeOn refuses nonsense rates and amounts instead of inventing a charge", () => {
  assert.equal(feeOn(0n, 15), 0n);
  assert.equal(feeOn(-10n, 15), 0n);
  assert.equal(feeOn(1_000_000n, 0), 0n);
  assert.equal(feeOn(1_000_000n, -5), 0n);
  assert.equal(feeOn(1_000_000n, NaN), 0n);
});
