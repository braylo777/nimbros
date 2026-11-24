import test from "node:test";
import assert from "node:assert/strict";
import { findOriginals, findVamps } from "./vamp.ts";
import type { Token } from "./types.ts";

const t = (o: Partial<Token>): Token => ({ id: "x", kind: "snipe", name: "Frog", ticker: "FROG", price: 1, changePct: 0, marketCap: 1, liquidity: 100, vol24h: 1, txns: 1, contract: "0xa::a::A", ...o });

test("younger same-ticker coins are vamps; older ones are originals", () => {
  const orig = t({ contract: "0xa::a::A", ageMin: 600, liquidity: 9000 });
  const copy = t({ contract: "0xb::b::B", ageMin: 30, name: "Frog 2", liquidity: 500 });
  const other = t({ contract: "0xc::c::C", ticker: "DOG", name: "Dog", ageMin: 10 });
  assert.deepEqual(findVamps(orig, [orig, copy, other]).map((x) => x.contract), ["0xb::b::B"]);
  assert.deepEqual(findOriginals(copy, [orig, copy, other]).map((x) => x.contract), ["0xa::a::A"]);
  assert.equal(findVamps(other, [orig, copy, other]).length, 0);
});
