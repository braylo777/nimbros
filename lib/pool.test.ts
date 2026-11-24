import test from "node:test";
import assert from "node:assert/strict";
import { POOL_ADDR, RANGE_SPEC, chartBars, chartPaths, fillMarks, normalizeCandles, normalizeTrades, pricePrecision, type Candle } from "./pool.ts";

test("candles: sorted oldest-first, bad rows dropped", () => {
  const j = { data: { attributes: { ohlcv_list: [[200, 1, 2, 0.5, 1.5, 10], [100, 1, 1, 1, 1, 0], ["x", 1, 1, 1, 1, 1], [300, 1, 2, 0.5]] } } };
  const c = normalizeCandles(j);
  assert.deepEqual(c.map((x) => x.t), [100, 200]);
  assert.deepEqual(normalizeCandles(null), []);
});
test("trades: side-aware price/size, newest first", () => {
  const mk = (kind: string, ts: string, extra: Record<string, unknown> = {}) => ({ attributes: { kind, block_timestamp: ts, tx_hash: "H", from_token_amount: "5", to_token_amount: "10", price_from_in_usd: "2", price_to_in_usd: "1", volume_in_usd: "10", ...extra } });
  const t = normalizeTrades({ data: [mk("buy", "2026-01-01T00:00:00Z"), mk("sell", "2026-01-01T00:00:10Z"), mk("wat", "2026-01-01T00:00:20Z"), mk("buy", "nope")] });
  assert.equal(t.length, 2);
  assert.equal(t[0].side, "sell");
  assert.equal(t[0].price, 2); assert.equal(t[0].size, 5); // sell: base leaves = from side
  assert.equal(t[1].price, 1); assert.equal(t[1].size, 10); // buy: base arrives = to side
});
test("chart paths: need 2 points, flat series safe, within bounds", () => {
  assert.equal(chartPaths([]), null);
  const flat = chartPaths([{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 0 }, { t: 2, o: 1, h: 1, l: 1, c: 1, v: 0 }]);
  assert.ok(flat && !flat.line.includes("NaN"));
});
test("pool address validation", () => {
  assert.ok(POOL_ADDR.test("PooP1111111111111111111111111111111111111111"));
  assert.ok(!POOL_ADDR.test("0x123"));
  assert.ok(!POOL_ADDR.test("PooP1111111111111111111111111111111111111111/../"));
});

const bar = (t: number, c = 1): Candle => ({ t, o: c, h: c, l: c, c, v: 0 });
const bars = [1000, 1060, 1120, 1180, 1240].map((t, i) => bar(t, i + 1));

test("intervals map onto GeckoTerminal frames and carry their bar length", () => {
  assert.equal(RANGE_SPEC["1m"].frame, "minute");
  assert.equal(RANGE_SPEC["4H"].aggregate, 4);
  assert.equal(RANGE_SPEC["1D"].secs, 86400);
  for (const k of Object.keys(RANGE_SPEC) as (keyof typeof RANGE_SPEC)[]) assert.ok(RANGE_SPEC[k].limit <= 1000);
});
test("chartBars: sorted, de-duplicated, later copy wins", () => {
  const out = chartBars([bar(200, 2), bar(100, 1), bar(200, 9), bar(300, 3)]);
  assert.deepEqual(out.map((b) => b.t), [100, 200, 300]);
  assert.equal(out[1].c, 9);
});
test("pricePrecision keeps tiny prices readable and large ones tidy", () => {
  assert.equal(pricePrecision(1.0132), 3);
  assert.equal(pricePrecision(1234), 2);
  assert.equal(pricePrecision(0.00002017), 8);
  assert.equal(pricePrecision(1e-15), 12);
  assert.equal(pricePrecision(0), 4);
  assert.equal(pricePrecision(NaN), 4);
});
test("fills snap to the bar they happened in", () => {
  const m = fillMarks(bars, [{ t: 1100 * 1000, side: "buy", price: 2 }, { t: 1179 * 1000, side: "sell", price: 3 }], 60);
  assert.deepEqual(m.map((x) => x.time), [1060, 1120]);
});
test("fills before the first bar or long after the last are dropped; a fill just after lands on the last bar", () => {
  assert.equal(fillMarks(bars, [{ t: 500 * 1000, side: "buy", price: 1 }], 60).length, 0);
  assert.equal(fillMarks(bars, [{ t: (1240 + 9999) * 1000, side: "buy", price: 1 }], 60).length, 0);
  const late = fillMarks(bars, [{ t: (1240 + 900) * 1000, side: "buy", price: 1 }], 60);
  assert.equal(late.length, 1);
  assert.equal(late[0].time, 1240);
  assert.deepEqual(fillMarks([], [{ t: 1, side: "buy", price: 1 }], 60), []);
});
