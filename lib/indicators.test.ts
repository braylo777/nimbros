import test from "node:test";
import assert from "node:assert/strict";
import { bigTrades, highOf, rsi, rsiSeries, smaSeries, volumeTone } from "./indicators.ts";
import type { Candle } from "./pool.ts";

const bars = (closes: number[]): Candle[] => closes.map((c, i) => ({ t: i, o: c, h: c + 1, l: c - 1, c, v: 1 }));

test("rsi: all gains is 100, all losses is 0, flat is 50, too few bars is null", () => {
  assert.equal(rsi(bars(Array.from({ length: 20 }, (_, i) => 10 + i))), 100);
  assert.equal(rsi(bars(Array.from({ length: 20 }, (_, i) => 30 - i))), 0);
  assert.equal(rsi(bars(Array(20).fill(5))), 50);
  assert.equal(rsi(bars([1, 2, 3])), null);
});
test("rsi: a textbook mixed series lands in between", () => {
  const v = rsi(bars([44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28]))!;
  assert.ok(v > 65 && v < 75, `rsi ${v}`);
});
test("highOf uses bar highs", () => {
  assert.equal(highOf(bars([1, 5, 3])), 6);
  assert.equal(highOf([]), null);
});
test("rsiSeries has one point per bar after the warm-up, ending at the latest rsi", () => {
  const b = bars(Array.from({ length: 30 }, (_, i) => 10 + Math.sin(i) * 3));
  const s = rsiSeries(b);
  assert.equal(s.length, 30 - 14);
  assert.equal(s[s.length - 1].v, rsi(b));
  assert.equal(rsiSeries(bars([1, 2])).length, 0);
});


const bar = (t: number, o: number, h: number, l: number, c: number, v: number) => ({ t, o, h, l, c, v });
const calm = (n: number) => Array.from({ length: n }, (_, i) => bar(i, 10, 10.5, 9.5, 10, 100));

test("rsiSeries in one pass matches rsi() at every point", () => {
  const bars = Array.from({ length: 60 }, (_, i) => bar(i, 1, 1, 1, 10 + Math.sin(i / 3) * 3 + i * 0.05, 1));
  const s = rsiSeries(bars);
  for (const k of [0, 7, 20, s.length - 1]) assert.ok(Math.abs(s[k].v - rsi(bars.slice(0, 15 + k))!) < 1e-9);
  assert.equal(s.length, bars.length - 14);
});

test("smaSeries averages the last len points", () => {
  const s = smaSeries([1, 2, 3, 4, 5].map((v, t) => ({ t, v })), 3);
  assert.deepEqual(s.map((x) => x.v), [2, 3, 4]);
});

test("a big lower-wick bar that closes high is sellers absorbed (bullish)", () => {
  const bars = [...calm(25), bar(25, 10, 10.2, 8, 10.1, 400)];
  const b = bigTrades(bars);
  assert.equal(b.length, 1);
  assert.deepEqual([b[0].kind, b[0].bias, b[0].large], ["sellers-absorbed", "bullish", true]);
});

test("a big upper-wick bar that closes low is buyers absorbed (bearish)", () => {
  const b = bigTrades([...calm(25), bar(25, 10, 12, 9.9, 9.95, 200)]);
  assert.deepEqual([b[0].kind, b[0].bias, b[0].large], ["buyers-absorbed", "bearish", false]);
});

test("strong bodies are accepted buying or selling; ordinary volume makes no bubble", () => {
  assert.equal(bigTrades([...calm(25), bar(25, 10, 12, 9.9, 11.9, 200)])[0].kind, "accepted-buying");
  assert.equal(bigTrades([...calm(25), bar(25, 12, 12.1, 10, 10.1, 200)])[0].kind, "accepted-selling");
  assert.equal(bigTrades([...calm(25), bar(25, 10, 11, 9, 10.5, 150)]).length, 0); // 1.5x is under the 1.6x bar
});

test("the first 20 bars can never be bubbles (no average yet)", () => {
  assert.equal(bigTrades(Array.from({ length: 15 }, (_, i) => bar(i, 10, 12, 8, 11.9, 1000))).length, 0);
});

test("volume tone: heavy above 1.618x the average, light below 0.618x", () => {
  const bars = [...calm(100), bar(100, 10, 11, 9, 10, 300), bar(101, 10, 11, 9, 10, 30)];
  const t = volumeTone(bars);
  assert.equal(t[100], "heavy");
  assert.equal(t[101], "light");
  assert.equal(t[50], "normal");
});
