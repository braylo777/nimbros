import test from "node:test";
import assert from "node:assert/strict";
import { GRADUATION_LIQ_USD, MAX_ROWS, splitTokens, stageOf, isStable, isActive, buildFeeds } from "./lifecycle.ts";
import type { Token } from "./types.ts";

const tok = (o: Partial<Token>): Token => ({
  id: `gt:${o.contract ?? "0xa::x::X"}:${o.liquidity ?? 0}`, kind: "snipe", name: "T", ticker: "T", price: 0.5, changePct: 12, marketCap: 0, liquidity: 3000, vol24h: 5000, txns: 50, contract: "0xa::x::X", ageMin: 3_000, ...o,
});

test("stageOf: at $25K liquidity a 3-day-old coin is a Scalp, below it neither", () => {
  assert.equal(stageOf({ liquidity: GRADUATION_LIQ_USD - 1, ageMin: 4_320 }), null);
  assert.equal(stageOf({ liquidity: GRADUATION_LIQ_USD, ageMin: 4_320 }), "scalp");
});

test("every token lands in exactly one list; stables and dust are dropped; kind follows the list", () => {
  const rows = [
    tok({ contract: "0x1::a::A", ticker: "AAA", liquidity: 3_000, ageMin: 10 }),
    tok({ contract: "0x2::b::B", ticker: "BBB", liquidity: 90_000, vol24h: 1_500 }),
    tok({ contract: "0x3::c::C", ticker: "USDC", liquidity: 9e6 }),      // stablecoin
    tok({ contract: "0x4::d::D", ticker: "DUST", liquidity: 100 }),      // dust
  ];
  const { snipe, scalp } = splitTokens(rows);
  assert.deepEqual(snipe.map((t) => t.ticker), ["AAA"]);
  assert.deepEqual(scalp.map((t) => t.ticker), ["BBB"]);
  assert.equal(snipe[0].kind, "snipe");
  assert.equal(scalp[0].kind, "agent");
  const ids = new Set([...snipe, ...scalp].map((t) => t.contract));
  assert.equal(ids.size, snipe.length + scalp.length); // no token in both
});

test("a token with several pools appears once, on its deepest pool, and can graduate", () => {
  const rows = [
    tok({ id: "gt:small", contract: "0x1::a::A", ticker: "AAA", liquidity: 3_000 }),
    tok({ id: "gt:deep", contract: "0x1::a::A", ticker: "AAA", liquidity: 40_000, vol24h: 4_000 }),
  ];
  const { snipe, scalp } = splitTokens(rows);
  assert.equal(snipe.length, 0);
  assert.deepEqual(scalp.map((t) => t.id), ["gt:deep"]);
});

test("Snipe is newest first (unknown ages are left out); Scalp is busiest first; lists are capped", () => {
  const rows = [
    tok({ contract: "0x1::a::A", ticker: "OLD", liquidity: 3000, ageMin: 500 }),
    tok({ contract: "0x2::b::B", ticker: "NEW", liquidity: 3000, ageMin: 3 }),
    tok({ contract: "0x3::c::C", ticker: "UNK", liquidity: 3000, ageMin: undefined }),
    tok({ contract: "0x4::d::D", ticker: "LOW", liquidity: 30_000, vol24h: 2_000 }),
    tok({ contract: "0x5::e::E", ticker: "HIGH", liquidity: 30_000, vol24h: 9_999 }),
  ];
  const { snipe, scalp } = splitTokens(rows);
  assert.deepEqual(snipe.map((t) => t.ticker), ["NEW", "OLD"]);
  assert.deepEqual(scalp.map((t) => t.ticker), ["HIGH", "LOW"]);
  const many = Array.from({ length: MAX_ROWS + 20 }, (_, i) => tok({ contract: `0x${i}::m::M`, ticker: `M${i}`, liquidity: 3000, ageMin: i }));
  assert.equal(splitTokens(many).snipe.length, MAX_ROWS);
});

test("buildFeeds reads GeckoTerminal pages and merges them", () => {
  const pool = (addr: string, sym: string, liq: number, ageMs = 2 * 3600_000) => ({
    id: addr, attributes: { address: addr, base_token_price_usd: "0.5", reserve_in_usd: String(liq), pool_created_at: new Date(Date.now() - ageMs).toISOString(), volume_usd: { h24: "5000" }, transactions: { h24: { buys: 30, sells: 30 } }, price_change_percentage: { h24: "12" } },
    relationships: { base_token: { data: { id: `sui-network_0x${addr}::m::M` } }, quote_token: { data: { id: "sui-network_0x2::sui::SUI" } }, dex: { data: { id: "cetus" } } },
    _sym: sym,
  });
  const page = (pools: ReturnType<typeof pool>[]) => ({ data: pools, included: pools.map((p) => ({ id: `sui-network_0x${p.id}::m::M`, attributes: { symbol: p._sym, name: p._sym } })) });
  const { snipe, scalp } = buildFeeds([page([pool("aa", "AAA", 3000), pool("bb", "BBB", 80000, 4 * 86_400_000)]), page([pool("bb", "BBB", 80000, 4 * 86_400_000), pool("cc", "CCC", 4000)])]);
  assert.deepEqual(snipe.map((t) => t.ticker).sort(), ["AAA", "CCC"]);
  assert.deepEqual(scalp.map((t) => t.ticker), ["BBB"]);
});

test("a coin under a day old is a Snipe whatever its liquidity", () => {
  assert.equal(stageOf({ liquidity: 900_000, ageMin: 60 }), "snipe");
  assert.equal(stageOf({ liquidity: 1_000, ageMin: 1_439 }), "snipe");
});

test("past a day, real liquidity makes it a Scalp", () => {
  assert.equal(stageOf({ liquidity: GRADUATION_LIQ_USD, ageMin: 1_440 }), "scalp");
  assert.equal(stageOf({ liquidity: GRADUATION_LIQ_USD - 1, ageMin: 2_000 }), null); // thin and past its first day: neither
});

test("old and thin coins are in neither list", () => {
  assert.equal(stageOf({ liquidity: 10_000, ageMin: 8 * 24 * 60 }), null);
  assert.equal(stageOf({ liquidity: 10_000, ageMin: 7 * 24 * 60 }), null);
  assert.equal(stageOf({ liquidity: 5_000_000, ageMin: 31 * 24 * 60 }), null); // older than 30 days: search only
  assert.equal(stageOf({ liquidity: 40_000, ageMin: 30 * 24 * 60 }), "scalp");
});

test("no known age means not listed: an unknown age is never assumed young", () => {
  assert.equal(stageOf({ liquidity: 30_000 }), null);
  assert.equal(stageOf({ liquidity: 3_000 }), null);
});

test("stablecoins are recognised by name and by behaviour", () => {
  assert.equal(isStable({ ticker: "USDC", price: 1, changePct: 0 }), true);
  assert.equal(isStable({ ticker: "USBD", price: 1.0048, changePct: 0.002 }), true); // any name: a $1 coin that does not move
  assert.equal(isStable({ ticker: "USDX", price: 1.001, changePct: 9 }), false);   // moving is not pegged
  assert.equal(isStable({ ticker: "FROG", price: 1, changePct: 40 }), false);
  assert.equal(isStable({ ticker: "FROG", price: 0.05, changePct: 0 }), false); // not near a dollar
});

test("splitTokens: stablecoins and dead coins appear in neither list; young coins are Snipe, established ones Scalp", () => {
  const mk = (ticker: string, over: Record<string, unknown>) => ({ id: `gt:${ticker}`, contract: `0x${ticker}::m::${ticker}`, ticker, name: ticker, price: 0.01, changePct: 5, marketCap: 1, liquidity: 30_000, vol24h: 5_000, txns: 60, ...over }) as never;
  const r = splitTokens([
    mk("NEW", { ageMin: 30, changePct: 25 }), mk("OLDBIG", { ageMin: 5_000 }), mk("DEAD", { ageMin: 20_000, liquidity: 5_000 }), mk("USDX", { price: 1, changePct: 0, ageMin: 9_000 }),
  ]);
  assert.deepEqual(r.snipe.map((t) => t.ticker), ["NEW"]);
  assert.deepEqual(r.scalp.map((t) => t.ticker), ["OLDBIG"]);
});

test("only actively traded coins are listed: dead or placeholder pools are dropped", () => {
  const mk2 = (ticker: string, over: Record<string, unknown>) => ({ id: `gt:${ticker}`, contract: `0x${ticker}::m::${ticker}`, ticker, name: ticker, price: 0.02, changePct: 8, marketCap: 1, liquidity: 30_000, vol24h: 9_000, txns: 80, ageMin: 3_000, ...over }) as never;
  const r = splitTokens([
    mk2("GOOD", {}),
    mk2("TEST", { vol24h: 0, txns: 0 }),                    // nobody trading it
    mk2("QUIET", { vol24h: 300, txns: 90 }),                // trades, but under $1K a day
    mk2("BOTS", { vol24h: 9_000, txns: 6 }),                // a few big trades only
    mk2("TINY", { liquidity: 1_500 }),                      // placeholder pool
    mk2("NEWOK", { ageMin: 90, vol24h: 4_000, txns: 12, changePct: 25 }),  // brand new: a lower trade count is enough
  ]);
  assert.deepEqual(r.scalp.map((t) => t.ticker), ["GOOD"]);
  assert.deepEqual(r.snipe.map((t) => t.ticker), ["NEWOK"]);
});

test("isActive: the trade-count bar is lower for coins under a day old", () => {
  assert.equal(isActive({ vol24h: 2_000, txns: 10, ageMin: 100 }), true);
  assert.equal(isActive({ vol24h: 2_000, txns: 10, ageMin: 5_000 }), false);
  assert.equal(isActive({ vol24h: 999, txns: 500, ageMin: 5_000 }), false);
  assert.equal(isActive({ vol24h: 5_000, txns: 0, buys24h: 15, sells24h: 10, ageMin: 5_000 }), true); // buys + sells count
});

test("a coin takes the age of its oldest pool, even when a newer pool is the deepest", () => {
  const r = splitTokens([
    tok({ id: "gt:old", contract: "0x1::a::A", ticker: "AAA", liquidity: 30_000, ageMin: 20_000 }),
    tok({ id: "gt:new", contract: "0x1::a::A", ticker: "AAA", liquidity: 90_000, ageMin: 20 }),   // a fresh pool on another exchange
  ]);
  assert.equal(r.snipe.length, 0);
  assert.equal(r.scalp[0].id, "gt:new");
  assert.equal(r.scalp[0].ageMin, 20_000);
});

test("Snipe keeps only runners and Scalp only coins holding up; coins over 30 days old are in neither list", () => {
  const mk = (ticker: string, over: Record<string, unknown>) => ({ id: `gt:${ticker}`, contract: `0x${ticker}::m::${ticker}`, ticker, name: ticker, price: 0.01, changePct: 5, marketCap: 1, liquidity: 30_000, vol24h: 5_000, txns: 60, ...over }) as never;
  const r = splitTokens([
    mk("RUN", { ageMin: 60, changePct: 40 }), mk("FLAT", { ageMin: 60, changePct: 3 }), mk("DUMP", { ageMin: 60, changePct: -30 }),
    mk("HOLD", { ageMin: 5_000, changePct: 2 }), mk("FALL", { ageMin: 5_000, changePct: -12 }), mk("ANCIENT", { ageMin: 45 * 24 * 60, changePct: 50 }),
  ]);
  assert.deepEqual(r.snipe.map((t) => t.ticker), ["RUN"]);
  assert.deepEqual(r.scalp.map((t) => t.ticker), ["HOLD"]);
});
