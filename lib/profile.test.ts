import test from "node:test";
import assert from "node:assert/strict";
import { cleanProfile, profileMessage } from "./profile.ts";

test("keeps valid https links, drops empties", () => {
  const p = cleanProfile({ x: "https://x.com/nimbros", website: "https://nimbros.ai", telegram: "", pair: null });
  assert.deepEqual(p, { x: "https://x.com/nimbros", website: "https://nimbros.ai/" });
});
test("rejects http, wrong hosts, credentials, junk", () => {
  assert.equal(cleanProfile({ website: "http://a.com" }), null);
  assert.equal(cleanProfile({ x: "https://evil.com/x" }), null);
  assert.equal(cleanProfile({ website: "https://u:p@a.com" }), null);
  assert.equal(cleanProfile({ website: "javascript:alert(1)" }), null);
  assert.equal(cleanProfile("nope"), null);
});
test("pair needs a sane chain and reference", () => {
  assert.deepEqual(cleanProfile({ pair: { chain: "Solana", ref: "So11111111111111111111111111111111111111112" } })?.pair?.chain, "Solana");
  assert.equal(cleanProfile({ pair: { chain: "S", ref: "abc" } }), null);
  assert.equal(cleanProfile({ pair: { chain: "Solana", ref: "<script>" } }), null);
});
test("cleaning is idempotent, so client and server sign the same bytes", () => {
  const a = cleanProfile({ website: "https://nimbros.ai", x: "https://twitter.com/a" })!;
  assert.deepEqual(cleanProfile(a), a);
  assert.equal(profileMessage("0x1::a::A", a), profileMessage("0x1::a::A", cleanProfile(a)!));
});
