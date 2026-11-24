import test from "node:test";
import assert from "node:assert/strict";
import { PAD_BARS, indexAt, latestView, money, nearestBar, niceTicks, panBy, priceAt, priceRange, timeLabel, xOf, yOf, zoomAround } from "./scales.ts";

test("nice ticks are round numbers inside the range", () => {
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(87_000, 131_000, 4), [100_000, 120_000]);
  const t = niceTicks(0.000041, 0.000049, 4);
  assert.ok(t.length >= 2 && t.every((v) => v >= 0.000041 - 1e-12 && v <= 0.000049 + 1e-12));
  assert.deepEqual(niceTicks(5, 5), [5]);
  assert.deepEqual(niceTicks(NaN, 5), []);
});

test("x and index are inverses", () => {
  const v = { from: 10, to: 110 };
  assert.equal(xOf(60, v, 500), 250);
  assert.equal(indexAt(250, v, 500), 60);
  assert.equal(nearestBar(250, v, 500, 200), 60);
  assert.equal(nearestBar(25, { from: -5, to: 95 }, 500, 200), 0);
  assert.equal(nearestBar(0, { from: -5, to: 95 }, 500, 200), null); // that pixel is over empty padding
  assert.equal(nearestBar(499, { from: 150, to: 250 }, 500, 200), null); // past the data
});

test("y and price are inverses, and the top is the highest price", () => {
  assert.equal(yOf(200, 100, 200, 10, 400), 10);
  assert.equal(yOf(100, 100, 200, 10, 400), 410);
  assert.ok(Math.abs(priceAt(yOf(137, 100, 200, 10, 400), 100, 200, 10, 400) - 137) < 1e-9);
});

test("zoom keeps the bar under the pointer where it was", () => {
  const v = { from: 0, to: 100 };
  const z = zoomAround(v, 0.5, 25, 300);
  assert.ok(Math.abs((25 - z.from) / (z.to - z.from) - 0.25) < 1e-9);
  assert.ok(z.to - z.from < 100);
});

test("zoom has limits: never below 12 bars, never beyond the data plus padding", () => {
  assert.ok(zoomAround({ from: 0, to: 20 }, 0.01, 10, 300).to - zoomAround({ from: 0, to: 20 }, 0.01, 10, 300).from >= 12);
  const out = zoomAround({ from: 0, to: 100 }, 50, 50, 100);
  assert.ok(out.from >= -PAD_BARS && out.to <= 100 + PAD_BARS);
});

test("pan moves with the finger and stops at the ends", () => {
  const p = panBy({ from: 50, to: 150 }, 100, 500, 300); // 20% of the view, towards older bars
  assert.equal(p.from, 30);
  assert.equal(p.to, 130);
  const edge = panBy({ from: 0, to: 100 }, 10_000, 500, 300);
  assert.equal(edge.from, -PAD_BARS);
  assert.equal(edge.to - edge.from, 100);
});

test("price range covers the bars in view with padding, and flat data still has a range", () => {
  const bars = [{ h: 12, l: 8 }, { h: 15, l: 10 }, { h: 9, l: 5 }];
  const r = priceRange(bars, { from: 0, to: 1 })!;
  assert.ok(r.lo < 8 && r.hi > 15);
  const flat = priceRange([{ h: 7, l: 7 }, { h: 7, l: 7 }], { from: 0, to: 1 })!;
  assert.ok(flat.hi > flat.lo);
  assert.equal(priceRange([], { from: 0, to: 1 }), null);
});

test("latest view shows the newest bars with a little room on the right", () => {
  const v = latestView(500, 120);
  assert.equal(v.from, 380);
  assert.equal(v.to, 502);
  assert.equal(latestView(30, 120).from, -PAD_BARS);
});

test("money formats market caps and prices", () => {
  assert.equal(money(1_234_000), "$1.23M");
  assert.equal(money(340_000), "$340K");
  assert.equal(money(12_500), "$12.5K");
  assert.equal(money(0.000041, false), "$0.00004100"); // four significant digits
  assert.equal(money(2.5, false), "$2.50");
});

test("time labels: clock within a day, date across days", () => {
  const t = Date.UTC(2026, 8, 24, 3, 30, 0) / 1000;
  assert.match(timeLabel(t, 60), /^\d\d:\d\d$/);
  assert.match(timeLabel(t, 86_400), /^Sep \d+$/);
  assert.match(timeLabel(t, 60, true), /^Sep \d+, \d\d:\d\d$/);
  assert.match(timeLabel(t, 1), /^\d\d:\d\d:\d\d$/);
});
