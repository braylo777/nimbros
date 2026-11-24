import test from "node:test";
import assert from "node:assert/strict";
import { parseFills, positionFor, type Fill } from "./fills.ts";

const f = (side: "buy" | "sell", tokens: number, usd: number, ts = 1): Fill => ({ coin: "0x1::c::C", side, tokensRaw: String(tokens * 1e9), decimals: 9, usd, ts });

test("a single buy: pnl is value minus what was paid", () => {
  const p = positionFor([f("buy", 100, 10)], 100n * 10n ** 9n, 9, 0.15);
  assert.equal(p.value, 15);
  assert.equal(p.basis, 10);
  assert.ok(Math.abs(p.pnl! - 5) < 1e-9);
  assert.ok(Math.abs(p.pnlPct! - 50) < 1e-9);
});
test("a partial sell removes cost proportionally", () => {
  const p = positionFor([f("buy", 100, 10), f("sell", 50, 9)], 50n * 10n ** 9n, 9, 0.2);
  assert.equal(p.basis, 5);
  assert.ok(Math.abs(p.pnl! - 5) < 1e-9);
});
test("coins bought elsewhere have no basis, and tracked never exceeds what is held", () => {
  const none = positionFor([], 10n * 10n ** 9n, 9, 1);
  assert.equal(none.pnl, null);
  assert.equal(none.value, 10);
  const less = positionFor([f("buy", 100, 10)], 20n * 10n ** 9n, 9, 1);
  assert.equal(less.tracked, 20);
  assert.equal(less.basis, 2);
});
test("parseFills drops malformed rows", () => {
  const good = f("buy", 1, 1);
  assert.equal(parseFills(JSON.stringify([good, { coin: 1 }, { ...good, tokensRaw: "1.5" }, null])).length, 1);
  assert.deepEqual(parseFills("not json"), []);
});
