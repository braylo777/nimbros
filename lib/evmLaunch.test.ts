import test from "node:test";
import assert from "node:assert/strict";
import { buildEvmLaunch } from "./evmLaunch.ts";
import { TOKEN_BYTECODE } from "./erc20Bytecode.ts";

const ok = { chain: "bsc", name: "Moon Cat", symbol: "mcat", supplyWhole: "1000000000", address: "0x00000000000000000000000000000000000a11ce" };

test("a valid launch builds creation code plus constructor arguments", () => {
  const r = buildEvmLaunch(ok);
  assert.ok(r.ok);
  if (r.ok) { assert.ok(r.data.startsWith(TOKEN_BYTECODE)); assert.equal(r.input.symbol, "MCAT"); assert.equal(r.input.decimals, 18); assert.equal(r.chain.id, "bsc"); }
});
test("solana, unknown chains and bad addresses are refused", () => {
  assert.equal(buildEvmLaunch({ ...ok, chain: "solana" }).ok, false);
  assert.equal(buildEvmLaunch({ ...ok, chain: "nope" }).ok, false);
  assert.equal(buildEvmLaunch({ ...ok, address: "So11111111111111111111111111111111111111112" }).ok, false);
});
test("imitation names and odd supplies are refused, like on Solana", () => {
  assert.equal(buildEvmLaunch({ ...ok, symbol: "USDC" }).ok, false);
  assert.equal(buildEvmLaunch({ ...ok, name: "Wrapped Ether", symbol: "WETH" }).ok, false);
  assert.equal(buildEvmLaunch({ ...ok, supplyWhole: "12345" }).ok, false);
});
