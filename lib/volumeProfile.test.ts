import test from "node:test";
import assert from "node:assert/strict";
import { volumeProfile } from "./volumeProfile.ts";

const bar = (o: number, h: number, l: number, c: number, v: number) => ({ t: 0, o, h, l, c, v });

test("volume is conserved across the levels", () => {
  const p = volumeProfile([bar(1, 4, 1, 3, 90), bar(3, 3.5, 2, 2, 30)], 10, 1, 4)!;
  assert.ok(Math.abs(p.rows.reduce((s, r) => s + r.total, 0) - 120) < 1e-9);
});

test("a bar with no range lands in a single level", () => {
  const p = volumeProfile([bar(2, 2, 2, 2, 50)], 4, 1, 5)!;
  assert.equal(p.rows.filter((r) => r.total > 0).length, 1);
  assert.equal(p.rows[p.poc].total, 50);
});

test("up and down bars are kept apart", () => {
  const p = volumeProfile([bar(1, 2, 1, 2, 10), bar(2, 2, 1, 1, 6)], 1 + 1, 1, 2)!;
  assert.equal(p.rows[0].up + p.rows[1].up, 10);
  assert.equal(p.rows[0].down + p.rows[1].down, 6);
});

test("the point of control is the heaviest level and the value area contains it", () => {
  const p = volumeProfile([bar(1, 1.1, 1, 1.1, 10), bar(5, 5.1, 5, 5.05, 80), bar(9, 9.1, 9, 9.05, 10)], 10, 1, 10, 0.7)!;
  assert.equal(p.poc, 4);
  assert.ok(p.area[0] <= p.poc && p.poc <= p.area[1]);
  assert.equal(p.area[0], p.area[1]); // the POC alone already holds 80% of the volume
});

test("nothing to show gives null", () => {
  assert.equal(volumeProfile([], 10, 1, 2), null);
  assert.equal(volumeProfile([bar(1, 2, 1, 2, 0)], 10, 1, 2), null);
  assert.equal(volumeProfile([bar(1, 2, 1, 2, 5)], 10, 2, 2), null);
});
