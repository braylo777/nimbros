import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEvmPools, splitEvmTokens } from "./evmFeed.ts";

const wbnb = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const pool = (sym: string, ageHours: number, liq: number) => ({
  data: [{
    attributes: { address: sym.padEnd(40, "0"), name: `${sym} / WBNB`, base_token_price_usd: "0.01", reserve_in_usd: String(liq), pool_created_at: new Date(Date.now() - ageHours * 3600_000).toISOString(), price_change_percentage: { h24: "12" }, volume_usd: { h24: "5000" }, transactions: { h24: { buys: 10, sells: 5 } } },
    relationships: { base_token: { data: { id: "bsc_0x" + sym.padEnd(38, "1") } }, quote_token: { data: { id: "bsc_" + wbnb } }, dex: { data: { id: "pancakeswap-v2" } } },
  }],
  included: [{ id: "bsc_0x" + sym.padEnd(38, "1"), attributes: { symbol: sym, name: sym, image_url: "https://i.example/x.png" } }],
});

test("a BNB Chain pool quoted in WBNB with real liquidity normalizes", () => {
  const rows = normalizeEvmPools([pool("FRESH", 2, 30_000)], "bsc");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ticker, "FRESH");
  assert.equal(rows[0].id, `bsc:${"FRESH".padEnd(40, "0")}`);
});

test("a pool NOT quoted in the chain's wrapped native token is dropped", () => {
  const p = pool("ODD", 2, 30_000);
  p.data[0].relationships.quote_token.data.id = "bsc_0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead";
  assert.equal(normalizeEvmPools([p], "bsc").length, 0);
});

test("dust liquidity is dropped", () => {
  assert.equal(normalizeEvmPools([pool("DUST", 2, 500)], "bsc").length, 0);
});

test("split: under 24h is snipe, older with graduation liquidity is scalp, older-and-thin is neither", () => {
  const fresh = normalizeEvmPools([pool("NEW", 2, 30_000)], "bsc")[0];
  const graduated = normalizeEvmPools([pool("OLD", 72, 30_000)], "bsc")[0];
  const thin = normalizeEvmPools([pool("THIN", 72, 2_000)], "bsc")[0];
  const { snipe, scalp } = splitEvmTokens([fresh, graduated, thin]);
  assert.deepEqual(snipe.map((t) => t.ticker), ["NEW"]);
  assert.deepEqual(scalp.map((t) => t.ticker), ["OLD"]);
});
