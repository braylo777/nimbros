import test from "node:test";
import assert from "node:assert/strict";
import { flagsOf, isChain, normalizeChainPools } from "./chainfeed.ts";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const ADDR = "0x" + "ab".repeat(20);
const pool = (o: Record<string, unknown> = {}, addr = ADDR) => ({
  data: [{ attributes: { address: "0xpool" + addr.slice(2, 8), name: "PEPE / WETH", base_token_price_usd: "0.01", reserve_in_usd: "20000", market_cap_usd: "500000", pool_created_at: "2026-09-28T11:30:00Z", price_change_percentage: { h24: "5" }, volume_usd: { h24: "3000" }, transactions: { h24: { buys: 4, sells: 3 } }, ...o },
    relationships: { base_token: { data: { id: "base_" + addr } }, dex: { data: { id: "uniswap-v4-base" } } } }],
  included: [{ id: "base_" + addr, attributes: { symbol: "PEPE", name: "Pepe", image_url: "https://i.example/p.png" } }],
});

test("reads a Base pool into the common shape", () => {
  const [r] = normalizeChainPools(pool(), "base", NOW);
  assert.equal(r.ticker, "PEPE");
  assert.equal(r.contract, ADDR);
  assert.equal(r.ageMin, 30);
  assert.equal(r.dex, "uniswap-v4-base");
  assert.ok(r.explorerUrl.startsWith("https://basescan.org/token/0x"));
  assert.ok(r.flags.includes("under an hour old"));
});
test("drops dust, bad addresses, bad prices and junk", () => {
  assert.equal(normalizeChainPools(pool({ reserve_in_usd: "100" }), "base", NOW).length, 0);
  assert.equal(normalizeChainPools(pool({}, "0xnope"), "base", NOW).length, 0);
  assert.equal(normalizeChainPools(pool({ base_token_price_usd: "0" }), "base", NOW).length, 0);
  assert.deepEqual(normalizeChainPools(null, "base", NOW), []);
});
test("red flags come only from the pool's own numbers", () => {
  assert.deepEqual(flagsOf({ liquidity: 50_000, vol24h: 1000, marketCap: 1e6, ageMin: 600, buys: 5, sells: 5 }), []);
  const f = flagsOf({ liquidity: 5000, vol24h: 500_000, marketCap: 1e7, ageMin: 10, buys: 40, sells: 0 });
  assert.equal(f.length, 5);
  assert.ok(isChain("bsc") && !isChain("solana") && !isChain("__proto__"));
});
