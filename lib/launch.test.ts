import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { buildLaunchTx, checkLaunch, launchInstructions, looksReserved } from "./launch.ts";
import { screenTx } from "./shield.ts";

test("valid launches pass and are normalised", () => {
  const r = checkLaunch({ name: " Sol Frog ", symbol: "frog", supplyWhole: "1000000000", decimals: 6 });
  assert.ok(r.ok && r.value.name === "Sol Frog" && r.value.symbol === "FROG" && r.value.supplyWhole === 1_000_000_000n);
});
test("bad names, symbols, supplies and decimals are refused with a reason each", () => {
  const r = checkLaunch({ name: "x", symbol: "no way", supplyWhole: "7", decimals: 4 });
  assert.ok(!r.ok && ["name", "symbol", "supplyWhole", "decimals"].every((k) => k in r.errors));
});
test("imitations of established coins are refused, including look-alikes", () => {
  for (const s of ["SOL", "USDC", "U5DC", "B0NK", "TRUMPP", "N1MBROS"]) assert.ok(looksReserved(s), s);
  assert.ok(looksReserved("FROG", "Bitcoin") === false);
  assert.ok(!looksReserved("FROG", "Sol Frog"));
  assert.ok(!checkLaunch({ name: "Solana", symbol: "GOLD", supplyWhole: "1000000", decimals: 6 }).ok);
});
test("the launch transaction has the six fixed steps, revokes the mint, and Shield reads it as safe", () => {
  const owner = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
  const input = { name: "Sol Frog", symbol: "FROG", supplyWhole: 1_000_000n, decimals: 6 };
  const ixs = launchInstructions({ owner, mint, input, mintRentLamports: 1_461_600 });
  assert.equal(ixs.length, 6);
  assert.deepEqual([...ixs[5].data], [6, 0, 0]); // SetAuthority(MintTokens -> none), last
  assert.equal(ixs[1].data[ixs[1].data.length - 1], 0); // no freeze authority
  assert.equal(ixs[3].data.readBigUInt64LE(1), 1_000_000n * 10n ** 6n); // the whole supply, once
  const r = screenTx(buildLaunchTx({ owner, mint, input, mintRentLamports: 1_461_600, blockhash: "11111111111111111111111111111111" }), owner.toBase58());
  assert.notEqual(r.verdict, "block", JSON.stringify(r.findings));
  assert.ok(r.findings.some((f) => f.code === "REVOKE_AUTHORITY"));
});
