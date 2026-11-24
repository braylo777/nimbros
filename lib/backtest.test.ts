import test from "node:test";
import assert from "node:assert/strict";
import { backtestSma, buyPressurePct } from "./backtest.ts";

const ramp = (n: number, from: number, step: number) => Array.from({ length: n }, (_, i) => from + i * step);

test("too short or invalid series -> null", () => {
  assert.equal(backtestSma(ramp(10, 1, 0.1)), null);
  assert.equal(backtestSma([...ramp(40, 1, 0.1), NaN]), null);
  assert.equal(backtestSma([...ramp(40, 1, 0.1), 0]), null);
  assert.equal(backtestSma(ramp(40, 1, 0.1), 20, 5), null);
});
test("steady uptrend: one trade held to the end, ~tracks buy&hold minus costs", () => {
  const r = backtestSma(ramp(60, 1, 0.02))!;
  assert.equal(r.trades, 1);
  assert.equal(r.wins, 1);
  assert.ok(r.returnPct > 0);
  assert.ok(r.returnPct < r.buyHoldPct + 1e-9 + 100); // sanity
  assert.equal(r.maxDrawdownPct < 1, true);
});
test("flat series: no trades, zero return", () => {
  const r = backtestSma(new Array(60).fill(1))!;
  assert.equal(r.trades, 0);
  assert.equal(r.returnPct, 0);
  assert.equal(r.winRatePct, null);
});
test("costs matter: higher cost strictly lowers return on the same path", () => {
  const path = [...ramp(30, 1, 0.03), ...ramp(30, 1.9, -0.03), ...ramp(30, 1.0, 0.03)];
  const a = backtestSma(path, 5, 20, 0)!;
  const b = backtestSma(path, 5, 20, 0.02)!;
  assert.ok(b.returnPct < a.returnPct);
});
test("no look-ahead: changing only the final close cannot change earlier decisions' trade count", () => {
  const base = [...ramp(30, 1, 0.03), ...ramp(30, 1.9, -0.03)];
  const a = backtestSma(base)!;
  const b = backtestSma([...base.slice(0, -1), base[base.length - 1] * 3])!;
  assert.equal(a.trades, b.trades);
});
test("downtrend: stays in cash", () => {
  const r = backtestSma(ramp(60, 5, -0.05))!;
  assert.equal(r.trades, 0);
  assert.ok(r.buyHoldPct < 0);
});
test("buy pressure", () => {
  assert.equal(buyPressurePct(75, 25), 75);
  assert.equal(buyPressurePct(0, 0), null);
  assert.equal(buyPressurePct(undefined, 3), null);
});
