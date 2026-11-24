import test from "node:test";
import assert from "node:assert/strict";
import { DS_QUERIES, dsQueriesFor, KNOWN_DEXES, allDexes, HOT_URLS, MAX_POOLS, STALE_MS, coldUrls, mergePools, needsReserves, pickSources, type CachedPool } from "./poolCache.ts";
import type { Token } from "./types.ts";

const tok = (o: Partial<Token>): Token => ({ id: "gt:a", kind: "snipe", name: "T", ticker: "T", price: 1, changePct: 0, marketCap: 0, liquidity: 1000, vol24h: 0, txns: 0, contract: "XMint11111111111111111111111111111111111", ...o });
const DEX = ["pump-fun", "raydium", "meteora-dbc"];

test("pickSources: always the hot pages, plus a moving window of the rest that eventually covers everything", () => {
  const cold = coldUrls(DEX);
  const seen = new Set<string>();
  for (let slot = 0; slot < Math.ceil(cold.length / 5) + 1; slot++) {
    const s = pickSources(DEX, slot, 5);
    assert.deepEqual(s.slice(0, HOT_URLS.length), HOT_URLS);
    assert.equal(s.length, HOT_URLS.length + 5);
    s.slice(HOT_URLS.length).forEach((u) => seen.add(u));
  }
  assert.equal(seen.size, cold.length);
  assert.ok(cold.some((u) => u.includes("/dexes/meteora-dbc/pools")), "every exchange is on the list");
  assert.ok(cold.every((u) => u.startsWith("https://api.geckoterminal.com/")));
  const noDex = pickSources([], 3); // no exchange list yet: still refreshes the hot pages and the deeper general pages
  assert.deepEqual(noDex.slice(0, HOT_URLS.length), HOT_URLS);
  assert.ok(noDex.length > HOT_URLS.length && noDex.every((u) => !u.includes("/dexes/")));
  assert.deepEqual(pickSources(DEX, -1, 5).length, HOT_URLS.length + 5);
});
test("second pages are only requested for exchanges that exist", () => {
  const withBig = coldUrls(["pump-fun", "meteora-dbc"]);
  assert.ok(withBig.some((u) => u.includes("/dexes/pump-fun/pools") && u.includes("page=2")));
  assert.ok(!coldUrls(["meteora-dbc"]).some((u) => u.includes("page=2&sort=h24_volume_usd_desc") && u.includes("/dexes/")));
});
test("mergePools: newest data wins, reserves and logos already known are kept, old pools age out", () => {
  const now = 10_000_000;
  const prev: CachedPool[] = [
    { ...tok({ id: "gt:keep", liquidity: 5000, logo: "https://e/l.png", reserveBase: 10, reserveQuoteUsd: 20 }), seen: now - 60_000 },
    { ...tok({ id: "gt:old", liquidity: 9000 }), seen: now - STALE_MS - 1 },
  ];
  const out = mergePools(prev, [tok({ id: "gt:keep", liquidity: 6000 }), tok({ id: "gt:new", liquidity: 100 })], now);
  const by = Object.fromEntries(out.map((p) => [p.id, p]));
  assert.equal(by["gt:keep"].liquidity, 6000);
  assert.equal(by["gt:keep"].logo, "https://e/l.png");
  assert.equal(by["gt:keep"].reserveQuoteUsd, 20);
  assert.equal(by["gt:keep"].seen, now);
  assert.ok(by["gt:new"]);
  assert.ok(!by["gt:old"]);
  assert.deepEqual(out.map((p) => p.id), ["gt:keep", "gt:new"]); // deepest pool first
});
test("mergePools caps the cache", () => {
  const many = Array.from({ length: MAX_POOLS + 50 }, (_, i) => tok({ id: `gt:${i}`, liquidity: i }));
  const out = mergePools([], many, 1);
  assert.equal(out.length, MAX_POOLS);
  assert.equal(out[0].liquidity, MAX_POOLS + 49);
});
test("needsReserves picks the busiest rows that lack reserves", () => {
  const rows: CachedPool[] = [
    { ...tok({ id: "gt:1", vol24h: 5 }), seen: 1 },
    { ...tok({ id: "gt:2", vol24h: 50 }), seen: 1 },
    { ...tok({ id: "gt:3", vol24h: 500, reserveQuoteUsd: 9 }), seen: 1 },
  ];
  assert.deepEqual(needsReserves(rows, 5).map((r) => r.id), ["gt:2", "gt:1"]);
  assert.deepEqual(needsReserves(rows, 1).map((r) => r.id), ["gt:2"]);
});

test("allDexes: the built-in list always applies, live additions are merged in, nothing is repeated", () => {
  assert.deepEqual(allDexes([]), KNOWN_DEXES);
  const merged = allDexes(["pump-fun", "brand-new-dex"]);
  assert.ok(merged.includes("brand-new-dex") && merged.includes("pumpswap"));
  assert.equal(new Set(merged).size, merged.length);
  assert.equal(pickSources(allDexes([]), 0).filter((u) => u.includes("/dexes/")).length > 0, true);
});

test("dsQueriesFor: a few searches per run, moving round the list so every term gets its turn", () => {
  const seen = new Set<string>();
  for (let slot = 0; slot < Math.ceil(DS_QUERIES.length / 6) + 1; slot++) { const q = dsQueriesFor(slot); assert.equal(q.length, 6); q.forEach((x) => seen.add(x)); }
  assert.equal(seen.size, DS_QUERIES.length);
  assert.deepEqual(dsQueriesFor(-3), dsQueriesFor(0));
  for (const name of ["pump.fun", "bonk.fun", "moonshot", "meteora"]) assert.ok(DS_QUERIES.includes(name), name);
});
