import test from "node:test";
import assert from "node:assert/strict";
import { humanCloses, normalizePools, normalizePredictions, safeIconUrl, withOnChainLogos } from "./feeds.ts";

const NOW = Date.parse("2026-09-18T12:00:00Z");
const mkt = (o: Record<string, unknown> = {}) => ({
  conditionId: "0xabc", question: "Will X happen?", endDate: "2026-09-20T12:00:00Z",
  outcomes: '["Yes","No"]', outcomePrices: '["0.62","0.38"]', volumeNum: 5000, volume24hr: 900,
  liquidityNum: 1200, oneDayPriceChange: 0.05, icon: "https://img.example/a.png", events: [{ slug: "x-event" }], ...o,
});

test("predictions: maps a binary market", () => {
  const [p] = normalizePredictions([mkt()], NOW);
  assert.equal(p.headline, "Will X happen?");
  assert.equal(Math.round(p.yesPct), 62);
  assert.equal(p.closesIn, "2d");
  assert.equal(p.url, "https://polymarket.com/event/x-event");
  assert.equal(p.image, "https://img.example/a.png");
  assert.equal(p.vol24h, 900);
});
test("predictions: drops non-binary, expired, malformed, out-of-range", () => {
  const rows = normalizePredictions([
    mkt({ outcomes: '["A","B"]' }), mkt({ endDate: "2026-09-01T00:00:00Z" }),
    mkt({ outcomePrices: "nope" }), mkt({ outcomePrices: '["1.7","0"]' }), mkt({ outcomePrices: '["0.001","0.999"]' }), null, "x",
  ], NOW);
  assert.equal(rows.length, 0);
});
test("predictions: non-https image dropped, non-array input safe", () => {
  assert.equal(normalizePredictions([mkt({ icon: "http://x/a.png", image: "javascript:1" })], NOW)[0].image, undefined);
  assert.deepEqual(normalizePredictions({}, NOW), []);
});
test("humanCloses", () => {
  assert.equal(humanCloses("2026-09-18T15:30:00Z", NOW), "3h");
  assert.equal(humanCloses("2026-09-18T12:10:00Z", NOW), "1h");
  assert.equal(humanCloses("2026-09-01T00:00:00Z", NOW), "0h");
});

const mintOf = (sym: string) => (sym + "Mint".padEnd(44, "1")).slice(0, 44).padEnd(44, "1");
const pool = (sym: string, liq: string, quote = "So11111111111111111111111111111111111111112", o: Record<string, unknown> = {}) => ({
  data: [{
    attributes: { address: (sym + "Pool".padEnd(44,"1")).slice(0,44).padEnd(44,"1"), name: `${sym} / SOL`, base_token_price_usd: "0.01", reserve_in_usd: liq,
      market_cap_usd: "9000", pool_created_at: "2026-09-18T11:00:00Z",
      price_change_percentage: { h24: "12.5" }, volume_usd: { h24: "300" },
      transactions: { h24: { buys: 4, sells: 6 } }, ...o },
    relationships: { base_token: { data: { id: "solana_" + mintOf(sym) } }, quote_token: { data: { id: "solana_" + quote } }, dex: { data: { id: "pump-fun" } } },
  }],
  included: [{ id: "solana_" + mintOf(sym), attributes: { symbol: sym, name: sym + " coin", image_url: "https://img.example/" + sym + ".png" } }],
});

test("snipe: keeps a real SOL-paired memecoin with all metadata", () => {
  const [t] = normalizePools(pool("PEPE", "5000"), "snipe", NOW);
  assert.equal(t.ticker, "PEPE");
  assert.equal(t.logo, "https://img.example/PEPE.png");
  assert.equal(t.ageMin, 60);
  assert.equal(t.txns, 10);
  assert.equal(t.changePct, 12.5);
  assert.equal(t.dex, "pump-fun");
  assert.equal(t.holders, undefined); // never invented
});
test("snipe: rejects dust, majors, non-SOL quote; scalp keeps majors", () => {
  assert.equal(normalizePools(pool("PEPE", "10"), "snipe", NOW).length, 0);
  assert.equal(normalizePools(pool("JUP", "90000"), "snipe", NOW).length, 0);
  assert.equal(normalizePools(pool("PEPE", "5000", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), "snipe", NOW).length, 0);
  assert.equal(normalizePools(pool("JUP", "90000"), "agent", NOW).length, 1);
  assert.equal(normalizePools(pool("USDC", "90000"), "agent", NOW).length, 0);
});
test("pools: accepts an array of pages; bad rows dropped", () => {
  assert.equal(normalizePools([pool("A", "5000"), pool("B", "5000")], "snipe", NOW).length, 2);
  assert.equal(normalizePools(pool("A", "5000", "So11111111111111111111111111111111111111112", { base_token_price_usd: "abc" }), "snipe", NOW).length, 0);
  assert.deepEqual(normalizePools(null, "snipe", NOW), []);
});
test("pools: one row per token, deepest pool wins", () => {
  const a = pool("DUP", "5000"), b = pool("DUP", "9000");
  b.data[0].attributes.address = "OtherPool11111111111111111111111111111111";
  const rows = normalizePools([a, b], "agent", NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].liquidity, 9000);
});

test("safeIconUrl: https and ipfs only", () => {
  assert.equal(safeIconUrl("https://a.com/x.png"), "https://a.com/x.png");
  assert.equal(safeIconUrl("ipfs://bafkreih3tsbok4gem7v5qqkkj56uygzf"), "https://ipfs.io/ipfs/bafkreih3tsbok4gem7v5qqkkj56uygzf");
  for (const bad of ["http://a.com/x", "javascript:alert(1)", "data:image/png;base64,AA", "ipfs://../etc", "", undefined, 5]) assert.equal(safeIconUrl(bad), undefined);
});
test("withOnChainLogos is a pass-through on Solana (logos come with the pool feeds) and never throws", async () => {
  const [t] = normalizePools(pool("PEPE", "5000"), "snipe", NOW);
  const noLogo = { ...t, logo: undefined };
  const out = await withOnChainLogos([noLogo, t], (async () => { throw new Error("net"); }) as typeof fetch);
  assert.equal(out[0].logo, undefined);
  assert.equal(out[1].logo, t.logo);
});

import { pegSymbol } from "./pegged.ts";
test("pegSymbol: always a short NMBR-suffixed symbol", () => {
  for (const t of ["MAGMA", "BASECAMP", "1INCH", "a-b", "SOL"]) {
    const s = pegSymbol(t);
    assert.ok(s.endsWith("NMBR") && s.length <= 10, s);
  }
});
