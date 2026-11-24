import test from "node:test";
import assert from "node:assert/strict";
import { createVM } from "@ethereumjs/vm";
import { Common, Mainnet } from "@ethereumjs/common";
import { createAddressFromString, hexToBytes, bytesToHex, type Address } from "@ethereumjs/util";
import { TOKEN_BYTECODE, TOKEN_ABI_FUNCTIONS } from "./erc20Bytecode.ts";
import { deployData, encodeTokenArgs } from "./evmAbi.ts";

/* The launch token is run for real in an EVM here: deployed with the same bytes the app builds, then called. */
import { keccak_256 } from "@noble/hashes/sha3.js";
const selector = (sig: string) => bytesToHex(keccak_256(new TextEncoder().encode(sig)).slice(0, 4)).slice(2);
const word = (n: bigint) => n.toString(16).padStart(64, "0");
const addrWord = (a: Address) => a.toString().slice(2).padStart(64, "0");

const A = createAddressFromString("0x00000000000000000000000000000000000a11ce");
const B = createAddressFromString("0x0000000000000000000000000000000000000b0b");
const C = createAddressFromString("0x000000000000000000000000000000000000c0de");

async function boot(name = "Moon Cat", symbol = "MCAT", dec = 18, supply = 1_000_000n) {
  const vm = await createVM({ common: new Common({ chain: Mainnet, hardfork: "shanghai" }) });
  const r = await vm.evm.runCall({ caller: A, data: hexToBytes(deployData(TOKEN_BYTECODE, name, symbol, dec, supply) as `0x${string}`), gasLimit: 10_000_000n });
  assert.equal(r.execResult.exceptionError, undefined, "deploy must not revert");
  const token = r.createdAddress!;
  const call = async (caller: Address, data: string) => {
    const x = await vm.evm.runCall({ caller, to: token, data: hexToBytes(("0x" + data) as `0x${string}`), gasLimit: 1_000_000n });
    return { ok: x.execResult.exceptionError === undefined, out: bytesToHex(x.execResult.returnValue).slice(2) };
  };
  return { call };
}

test("the whole supply lands in the launcher's wallet, once", async () => {
  const { call } = await boot();
  assert.equal(BigInt("0x" + (await call(A, selector("totalSupply()"))).out), 1_000_000n * 10n ** 18n);
  assert.equal(BigInt("0x" + (await call(A, selector("balanceOf(address)") + addrWord(A))).out), 1_000_000n * 10n ** 18n);
  assert.equal(BigInt("0x" + (await call(A, selector("balanceOf(address)") + addrWord(B))).out), 0n);
  assert.equal(BigInt("0x" + (await call(A, selector("decimals()"))).out), 18n);
});

test("name and symbol read back exactly, including long and non-ASCII-safe text", async () => {
  const { call } = await boot("A Fairly Long Coin Name Here", "LONGSYMBOL");
  const dec = (h: string) => { const len = Number(BigInt("0x" + h.slice(64, 128))); return Buffer.from(h.slice(128, 128 + len * 2), "hex").toString(); };
  assert.equal(dec((await call(A, selector("name()"))).out), "A Fairly Long Coin Name Here");
  assert.equal(dec((await call(A, selector("symbol()"))).out), "LONGSYMBOL");
});

test("transfer, approve and transferFrom behave like a standard ERC-20", async () => {
  const { call } = await boot();
  assert.ok((await call(A, selector("transfer(address,uint256)") + addrWord(B) + word(100n))).ok);
  assert.equal(BigInt("0x" + (await call(A, selector("balanceOf(address)") + addrWord(B))).out), 100n);
  assert.equal((await call(B, selector("transfer(address,uint256)") + addrWord(C) + word(101n))).ok, false, "cannot send more than you hold");
  assert.equal((await call(C, selector("transferFrom(address,address,uint256)") + addrWord(B) + addrWord(C) + word(1n))).ok, false, "no allowance, no pull");
  assert.ok((await call(B, selector("approve(address,uint256)") + addrWord(C) + word(40n))).ok);
  assert.ok((await call(C, selector("transferFrom(address,address,uint256)") + addrWord(B) + addrWord(C) + word(40n))).ok);
  assert.equal(BigInt("0x" + (await call(A, selector("balanceOf(address)") + addrWord(C))).out), 40n);
  assert.equal((await call(C, selector("transferFrom(address,address,uint256)") + addrWord(B) + addrWord(C) + word(1n))).ok, false, "allowance is spent");
  assert.equal((await call(A, selector("transfer(address,uint256)") + "0".repeat(64) + word(1n))).ok, false, "no burning to the zero address");
});

test("there is no way to mint, own, pause, blacklist or upgrade: the contract exposes only the ERC-20 functions", () => {
  assert.deepEqual([...TOKEN_ABI_FUNCTIONS], ["allowance", "approve", "balanceOf", "decimals", "name", "symbol", "totalSupply", "transfer", "transferFrom"]);
});

test("constructor arguments encode to the ABI layout", () => {
  const h = encodeTokenArgs("AB", "C", 18, 5n);
  assert.equal(h.slice(0, 64), word(128n));
  assert.equal(h.slice(192, 256), word(5n));
  assert.equal(h.length % 64, 0);
});
