import test from "node:test";
import assert from "node:assert/strict";
import { creatorFor, creatorLabel, ensureCreators, shortAddr } from "./creators.ts";

const A = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

test("label prefers a verified agent name, then a name, then a short address", () => {
  const c = { address: A, name: "frogmaker" };
  assert.equal(creatorLabel(c, { [A]: "alpha-bot" }), "@alpha-bot");
  assert.equal(creatorLabel(c, {}), "frogmaker");
  assert.equal(creatorLabel({ address: A }, {}), shortAddr(A));
  assert.equal(shortAddr(A), "9xQe…VFin");
});
test("there is no chain source for creators on Solana, so nothing is looked up or invented", async () => {
  await ensureCreators([A]);
  assert.equal(creatorFor({}, A), undefined);
});
