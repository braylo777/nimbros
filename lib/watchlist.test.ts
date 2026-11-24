import test from "node:test";
import assert from "node:assert/strict";
import { MAX_WATCH, changesFor, parseWatch, toggleWatch, type WatchItem } from "./watchlist.ts";

const it = (id: string, price = 1, liq = 1000): WatchItem => ({ id, ticker: id.toUpperCase(), name: id, addedAt: 1, priceAtAdd: price, liquidityAtAdd: liq });

test("changes are arithmetic on what we saved versus what is live", () => {
  const [c] = changesFor([it("a", 2, 1000)], [{ id: "a", price: 3, liquidity: 500 }]);
  assert.ok(Math.abs(c.priceChangePct! - 50) < 1e-9);
  assert.ok(Math.abs(c.liquidityChangePct! + 50) < 1e-9);
  assert.equal(c.missing, false);
});
test("a coin no longer in the live lists is 'missing', with no invented numbers", () => {
  const [c] = changesFor([it("gone")], [{ id: "other", price: 1, liquidity: 1 }]);
  assert.equal(c.missing, true);
  assert.equal(c.priceChangePct, null);
  assert.equal(c.liquidityChangePct, null);
});
test("toggle adds to the front, removes on second call, and caps the list", () => {
  let l: WatchItem[] = [];
  l = toggleWatch(l, it("a"));
  l = toggleWatch(l, it("b"));
  assert.deepEqual(l.map((x) => x.id), ["b", "a"]);
  l = toggleWatch(l, it("a"));
  assert.deepEqual(l.map((x) => x.id), ["b"]);
  let big: WatchItem[] = [];
  for (let i = 0; i < MAX_WATCH + 5; i++) big = toggleWatch(big, it(`c${i}`));
  assert.equal(big.length, MAX_WATCH);
});
test("parse: hostile or malformed storage is dropped, duplicates and http logos handled", () => {
  assert.deepEqual(parseWatch(null), []);
  assert.deepEqual(parseWatch("{"), []);
  assert.deepEqual(parseWatch('{"a":1}'), []);
  const p = parseWatch(JSON.stringify([it("a"), it("a"), { id: "b" }, { id: "c", ticker: "C", addedAt: 1, priceAtAdd: -1 }, { ...it("d"), logo: "http://x/y.png" }, null, "x"]));
  assert.deepEqual(p.map((x) => x.id), ["a", "d"]);
  assert.equal(p[1].logo, undefined);
});
