import test from "node:test";
import assert from "node:assert/strict";
import { cleanPresets, DEFAULT_PRESETS, parseBuy, parseSell } from "./quickPresets.ts";

test("buy sizes: positive, capped, plain decimals only", () => {
  assert.equal(parseBuy("15"), 15);
  assert.equal(parseBuy("0.5"), 0.5);
  assert.equal(parseBuy("0"), null);
  assert.equal(parseBuy("-3"), null);
  assert.equal(parseBuy("10001"), null);
  assert.equal(parseBuy("1e3"), null);
  assert.equal(parseBuy(""), null);
});
test("sell shares: whole percents 1 to 100, a trailing % is fine", () => {
  assert.equal(parseSell("45"), 45);
  assert.equal(parseSell("45%"), 45);
  assert.equal(parseSell("0"), null);
  assert.equal(parseSell("101"), null);
  assert.equal(parseSell("12.5"), null);
});
test("saved presets that are malformed fall back to the defaults", () => {
  assert.deepEqual(cleanPresets(null), DEFAULT_PRESETS);
  assert.deepEqual(cleanPresets({ buy: [15, 250, 1000], sell: [100, 45, 25, 10] }), { buy: [15, 250, 1000], sell: [100, 45, 25, 10] });
  assert.deepEqual(cleanPresets({ buy: [15, 250], sell: [100, 50, 25, 10] }).buy, DEFAULT_PRESETS.buy);
  assert.deepEqual(cleanPresets({ buy: [15, 250, 1000], sell: [100, 500, 25, 10] }).sell, DEFAULT_PRESETS.sell);
});
