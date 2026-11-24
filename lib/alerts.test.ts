import test from "node:test";
import assert from "node:assert/strict";
import { alertHit, makeAlert } from "./alerts.ts";

const C = "FrogMint1111111111111111111111111111111111";

test("alerts", () => {
  const a = makeAlert({ coin: C, dir: "above", price: 2 }, "a1", 1, 0);
  assert.ok(a.ok);
  if (a.ok) { assert.ok(alertHit(a.value, 2) && !alertHit(a.value, 1.9)); }
  assert.equal(makeAlert({ coin: C, dir: "up", price: 2 }, "a", 1, 0).ok, false);
  assert.equal(makeAlert({ coin: C, dir: "above", price: 2 }, "a", 1, 20).ok, false);
});
