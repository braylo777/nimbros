import test from "node:test";
import assert from "node:assert/strict";
import { LAUNCHPADS, WSOL_MINT, isSolAddress, launchpadOf, lamportsToSol } from "./chain.ts";
import { bs58decode } from "./solVerify.ts";

test("isSolAddress accepts real mints and wallets, rejects everything else", () => {
  for (const ok of [WSOL_MINT, "DK4ZbFhi9HnC2aWnmiPMZfbLMCWS8EAoFwnf79oSpump", "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"]) assert.ok(isSolAddress(ok), ok);
  for (const bad of ["", "0x2::sui::SUI", "0x" + "a".repeat(64), "short", WSOL_MINT + "11", "0OIl" + WSOL_MINT.slice(4), null, undefined, 5]) assert.ok(!isSolAddress(bad), String(bad));
});
test("launchpadOf maps dex ids to launchpads and knows nothing it wasn't told", () => {
  assert.equal(launchpadOf("pump-fun")?.name, "pump.fun");
  assert.equal(launchpadOf("pumpswap")?.id, "pumpfun");
  assert.equal(launchpadOf("letsbonk-fun")?.name, "bonk.fun");
  assert.equal(launchpadOf("raydium-launchlab")?.id, "bonk");
  assert.equal(launchpadOf("moonshot")?.name, "Moonshot");
  assert.equal(launchpadOf("some-other-dex"), undefined);
  assert.equal(launchpadOf(undefined), undefined);
  assert.ok(LAUNCHPADS.every((l) => l.url.startsWith("https://") && l.dex.length > 0));
});
test("lamports -> SOL", () => {
  assert.equal(lamportsToSol(1_500_000_000n), 1.5);
  assert.equal(lamportsToSol("1000000000"), 1);
});
test("bs58decode round-trips a known key and refuses junk", () => {
  const b = bs58decode(WSOL_MINT);
  assert.equal(b.length, 32);
  assert.equal(b[0], 6); // the WSOL mint's first byte
  assert.throws(() => bs58decode("0OIl"));
});
