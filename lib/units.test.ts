import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUnits, parseUnits } from "./units.ts";

test("parseUnits: exact integers, no float error (30.8, 0.1, 8.1105 are the classic offenders)", () => {
  assert.equal(parseUnits("30.8", 9), 30_800_000_000n);
  assert.equal(parseUnits("0.1", 9), 100_000_000n);
  assert.equal(parseUnits("1", 9), 1_000_000_000n);
  assert.equal(parseUnits("8.1105", 6), 8_110_500n);
  assert.equal(parseUnits(".5", 9), 500_000_000n);
  assert.equal(parseUnits("5.", 9), 5_000_000_000n);
  assert.equal(parseUnits("0.000000001", 9), 1n);
});

test("parseUnits: rejects anything that isn't a plain non-negative decimal", () => {
  for (const bad of ["", ".", "abc", "-1", "1e3", "1,5", "1.2.3", "0x10", " ", "1 000", "+1", "١٢"]) {
    assert.equal(parseUnits(bad, 9), null, JSON.stringify(bad));
  }
});

test("parseUnits: too many fractional digits is refused, never silently truncated", () => {
  assert.equal(parseUnits("1.0000000001", 9), null); // 10 dp on a 9-dp coin
  assert.equal(parseUnits("1.0000001", 6), null);
  assert.equal(parseUnits("1.000000", 6), 1_000_000n);
});

test("parseUnits: leading/trailing space tolerated, huge values stay exact", () => {
  assert.equal(parseUnits("  2.5  ", 9), 2_500_000_000n);
  assert.equal(parseUnits("123456789012345678.123456789", 9), 123456789012345678123456789n);
});

test("formatUnits round-trips and trims zeros", () => {
  assert.equal(formatUnits(1_500_000_000n, 9), "1.5");
  assert.equal(formatUnits(30_800_000_000n, 9), "30.8");
  assert.equal(formatUnits(8_110_500n, 6), "8.1105");
  assert.equal(formatUnits(1n, 9), "0.000000001");
  assert.equal(formatUnits(0n, 9), "0");
  assert.equal(formatUnits(1_000_000_000n, 9), "1");
  assert.equal(formatUnits(-8_110_500n, 6), "-8.1105");
  assert.equal(formatUnits(8_069_947n, 6, 4), "8.0699"); // display truncation
});

test("property: formatUnits(parseUnits(x)) === x for 5,000 random decimals", () => {
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 5_000; i++) {
    const d = [6, 9][i % 2];
    const raw = BigInt(Math.floor(rnd() * 1e12));
    const text = formatUnits(raw, d);
    assert.equal(parseUnits(text, d), raw, `${d}dp ${text}`);
  }
});
