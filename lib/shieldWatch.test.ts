import test from "node:test";
import assert from "node:assert/strict";
import { MAX_WATCHED, emptyWatch, keyOf, newAlerts, remember, withAddress } from "./shieldWatch.ts";
import type { Finding } from "./shield.ts";

const f = (level: Finding["level"], code: string, ref?: string): Finding => ({ level, code, message: "", ref });

test("only warn and block findings alert, and only when new", () => {
  const all = [f("info", "SOL_OUT"), f("warn", "DELEGATE", "acct1"), f("block", "DELEGATE_ACTOR", "acct2")];
  assert.deepEqual(newAlerts([], all).map(keyOf), ["DELEGATE:acct1", "DELEGATE_ACTOR:acct2"]);
  assert.deepEqual(newAlerts(remember(all), all), []);
});
test("a second approval on another account is new; the same one is not re-announced", () => {
  const seen = remember([f("warn", "DELEGATE", "acct1")]);
  assert.deepEqual(newAlerts(seen, [f("warn", "DELEGATE", "acct1"), f("warn", "DELEGATE", "acct9")]).map((x) => x.ref), ["acct9"]);
});
test("a finding that goes away and comes back alerts again", () => {
  const w = f("warn", "MINT_LIVE", "m1");
  const afterClear = remember([]);
  assert.equal(newAlerts(afterClear, [w]).length, 1);
});
test("watch list: add, dedupe, cap, remove", () => {
  let w = emptyWatch();
  for (let i = 0; i < MAX_WATCHED; i++) { const r = withAddress(w, "addr" + i, true); assert.ok(r.ok); if (r.ok) w = r.list; }
  const over = withAddress(w, "extra", true);
  assert.equal(over.ok, false);
  const dup = withAddress(w, "addr0", true);
  assert.ok(dup.ok && dup.list.addresses.length === MAX_WATCHED);
  const rm = withAddress({ ...w, seen: { addr0: ["x"] } }, "addr0", false);
  assert.ok(rm.ok && !rm.list.addresses.includes("addr0") && !("addr0" in rm.list.seen));
});
