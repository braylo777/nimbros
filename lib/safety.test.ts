import test from "node:test";
import assert from "node:assert/strict";
import { fmtSupply, summarizeSafety } from "./safety.ts";
import type { MintInfo } from "./solRpc.ts";

const T = "DK4ZbFhi9HnC2aWnmiPMZfbLMCWS8EAoFwnf79oSpump";
const info = (mintAuthority: string | null, freezeAuthority: string | null): MintInfo => ({
  decimals: 6, supply: "999999999999999532", mintAuthority, freezeAuthority, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
});
const lvl = (s: ReturnType<typeof summarizeSafety>, k: string) => s!.checks.find((c) => c.key === k)!.level;

test("revoked mint + revoked freeze authority are good", () => {
  const s = summarizeSafety(T, info(null, null));
  assert.equal(lvl(s, "mint"), "good");
  assert.equal(lvl(s, "freeze"), "good");
});
test("a live mint or freeze authority warns", () => {
  const s = summarizeSafety(T, info("Authority1111111111111111111111111111111111", "Authority1111111111111111111111111111111111"));
  assert.equal(lvl(s, "mint"), "warn");
  assert.equal(lvl(s, "freeze"), "warn");
});
test("mixed: mint revoked but freeze authority live", () => {
  const s = summarizeSafety(T, info(null, "Authority1111111111111111111111111111111111"));
  assert.equal(lvl(s, "mint"), "good");
  assert.equal(lvl(s, "freeze"), "warn");
});
test("unreadable mint is UNKNOWN, never good", () => {
  const s = summarizeSafety(T, null);
  assert.equal(lvl(s, "mint"), "unknown");
  assert.equal(lvl(s, "freeze"), "unknown");
  assert.match(s!.checks[2].detail, /Couldn't read/);
});
test("bad mint address", () => {
  assert.equal(summarizeSafety("not a coin", info(null, null)), null);
});
test("supply formatting", () => {
  assert.equal(fmtSupply("999999999999999532", 6), "999,999,999,999");
  assert.equal(fmtSupply("x", 9), "unknown");
  assert.match(summarizeSafety(T, info(null, null))!.checks[2].detail, /999,999,999,999 coins/);
});
