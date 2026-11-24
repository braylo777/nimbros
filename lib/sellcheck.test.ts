import test from "node:test";
import assert from "node:assert/strict";
import { classifySell } from "./sellcheck.ts";

const A = "Holder11111111111111111111111111111111111";
const SOL = "So11111111111111111111111111111111111111112";
const COIN = "FrogMint1111111111111111111111111111111111";
const base = { address: A, expectedOutRaw: 1_000_000_000n, coin: COIN, feeBps: 0 };
const ch = (n: bigint) => [{ coinType: SOL, address: A, amount: n.toString() }, { coinType: COIN, address: A, amount: "-5" }];

test("a normal sale is ok", () => {
  const v = classifySell({ ...base, success: true, changes: ch(985_000_000n) });
  assert.equal(v.verdict, "ok");
});
test("paying out far less than quoted is taxed", () => {
  const v = classifySell({ ...base, success: true, changes: ch(600_000_000n) });
  assert.equal(v.verdict, "taxed");
  if (v.verdict === "taxed") assert.ok(v.receivedPct < 65);
});
test("a revert with gas available is blocked, without gas it proves nothing", () => {
  assert.equal(classifySell({ ...base, success: false, changes: undefined, holderSuiRaw: 5_000_000_000n }).verdict, "blocked");
  assert.equal(classifySell({ ...base, success: false, changes: undefined, holderSuiRaw: 1000n }).verdict, "inconclusive");
});
test("missing data is inconclusive, never ok", () => {
  assert.equal(classifySell({ ...base, success: true, changes: undefined }).verdict, "inconclusive");
  assert.equal(classifySell({ ...base, success: true, changes: [] }).verdict, "inconclusive");
});
test("the platform fee widens the tolerance", () => {
  assert.equal(classifySell({ ...base, feeBps: 100, success: true, changes: ch(925_000_000n) }).verdict, "ok");
  assert.equal(classifySell({ ...base, feeBps: 0, success: true, changes: ch(925_000_000n) }).verdict, "taxed");
});
