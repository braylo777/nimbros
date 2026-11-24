import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FILTERS, PRESETS, activeCount, applyFilters, matches, parseAge, parseAmount, type UserFilters } from "./userFilters.ts";
import type { Token } from "./types.ts";

const tok = (o: Partial<Token>): Token => ({ id: "gt:x", kind: "snipe", name: "Sui Frog", ticker: "FROG", price: 1, changePct: 10, marketCap: 100_000, liquidity: 20_000, vol24h: 50_000, txns: 200, contract: "0xabc::frog::FROG", dex: "cetus", ageMin: 30, buys24h: 120, sells24h: 80, ...o });
const F = (o: Partial<UserFilters>): UserFilters => ({ ...EMPTY_FILTERS, ...o });

test("parseAmount understands k/m/b and rejects nonsense", () => {
  assert.equal(parseAmount("25k"), 25_000);
  assert.equal(parseAmount("1.5M"), 1_500_000);
  assert.equal(parseAmount("$2,000"), 2000);
  assert.equal(parseAmount("2b"), 2e9);
  assert.equal(parseAmount("-5"), -5);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("abc"), undefined);
  assert.equal(parseAmount("1e3"), undefined);
});
test("parseAge understands m/h/d", () => {
  assert.equal(parseAge("30"), 30);
  assert.equal(parseAge("2h"), 120);
  assert.equal(parseAge("1.5d"), 2160);
  assert.equal(parseAge(""), null);
  assert.equal(parseAge("soon"), undefined);
});
test("no criteria means everything passes; activeCount counts what is set", () => {
  const rows = [tok({}), tok({ ticker: "B" })];
  assert.equal(applyFilters(rows, EMPTY_FILTERS), rows);
  assert.equal(activeCount(EMPTY_FILTERS), 0);
  assert.equal(activeCount(F({ minLiq: 1, q: "x", dex: ["cetus"] })), 3);
  assert.equal(activeCount(F({ q: "  " })), 0);
});
test("each criterion filters on its own field, inclusive at the edges", () => {
  const t = tok({});
  assert.ok(matches(t, F({ minLiq: 20_000 })) && !matches(t, F({ minLiq: 20_001 })));
  assert.ok(matches(t, F({ maxLiq: 20_000 })) && !matches(t, F({ maxLiq: 19_999 })));
  assert.ok(matches(t, F({ minVol: 50_000 })) && !matches(t, F({ minVol: 50_001 })));
  assert.ok(matches(t, F({ minMcap: 100_000, maxMcap: 100_000 })));
  assert.ok(matches(t, F({ minAgeMin: 30, maxAgeMin: 30 })) && !matches(t, F({ maxAgeMin: 29 })));
  assert.ok(matches(t, F({ minChange: 10 })) && !matches(t, F({ maxChange: 9 })));
  assert.ok(matches(t, F({ minTxns: 200 })) && !matches(t, F({ minTxns: 201 })));
  assert.ok(matches(t, F({ minBuyPct: 60 })) && !matches(t, F({ minBuyPct: 61 })));
  assert.ok(matches(t, F({ dex: ["cetus", "bluefin"] })) && !matches(t, F({ dex: ["bluefin"] })));
});
test("search matches name, ticker or contract, ignoring case", () => {
  const t = tok({});
  for (const q of ["frog", "SUI FR", "0xABC"]) assert.ok(matches(t, F({ q })), q);
  assert.ok(!matches(t, F({ q: "toad" })));
});
test("unknown data never counts as a match", () => {
  assert.ok(!matches(tok({ ageMin: undefined }), F({ maxAgeMin: 60 })));
  assert.ok(!matches(tok({ buys24h: undefined }), F({ minBuyPct: 50 })));
  assert.ok(!matches(tok({ dex: undefined }), F({ dex: ["cetus"] })));
  assert.ok(matches(tok({ ageMin: undefined }), F({ minLiq: 1 }))); // only criteria that are set need their field
});
test("criteria combine with AND, and the presets are usable filters", () => {
  const rows = [tok({ ticker: "A", ageMin: 10, liquidity: 500_000 }), tok({ ticker: "B", ageMin: 500, liquidity: 500_000 }), tok({ ticker: "C", ageMin: 10, liquidity: 100 })];
  assert.deepEqual(applyFilters(rows, F({ maxAgeMin: 60, minLiq: 1000 })).map((t) => t.ticker), ["A"]);
  for (const p of PRESETS) assert.ok(activeCount(F(p.f)) > 0 && p.help.length > 10, p.id);
  const fresh = PRESETS.find((p) => p.id === "fresh")!;
  assert.deepEqual(applyFilters(rows, F(fresh.f)).map((t) => t.ticker), ["A"]); // C is fresh but under $2K liquidity
});

test("every measure takes a min and a max, and a min/max pair counts once", () => {
  const t = tok({});
  assert.ok(matches(t, F({ maxVol: 50_000 })) && !matches(t, F({ maxVol: 49_999 })));
  assert.ok(matches(t, F({ maxTxns: 200 })) && !matches(t, F({ maxTxns: 199 })));
  assert.ok(matches(t, F({ maxBuyPct: 60 })) && !matches(t, F({ maxBuyPct: 59 })));
  assert.equal(activeCount(F({ minLiq: 1, maxLiq: 9 })), 1);
  assert.equal(activeCount(F({ minLiq: 1, maxVol: 9 })), 2);
});
test("turnover and liquidity-share-of-market-cap use the right ratios and refuse unknowns", () => {
  const t = tok({ vol24h: 60_000, liquidity: 20_000, marketCap: 100_000 }); // 3.0x turnover, liquidity is 20% of market cap
  assert.ok(matches(t, F({ minTurn: 3, maxTurn: 3 })) && !matches(t, F({ minTurn: 3.01 })));
  assert.ok(matches(t, F({ minLiqPct: 20, maxLiqPct: 20 })) && !matches(t, F({ minLiqPct: 20.1 })));
  assert.ok(!matches(tok({ marketCap: 0 }), F({ minLiqPct: 1 })));   // no market cap reported: unknown, never a match
  assert.ok(!matches(tok({ liquidity: 0 }), F({ minTurn: 0 })));     // no liquidity: turnover is undefined
});
test("the presets keep what they say they keep", () => {
  const P = (id: string) => F(PRESETS.find((p) => p.id === id)!.f);
  assert.ok(matches(tok({ liquidity: 20_000, vol24h: 12_000 }), P("graduating")));
  assert.ok(!matches(tok({ liquidity: 25_001, vol24h: 12_000 }), P("graduating"))); // already graduated
  assert.ok(matches(tok({ changePct: 25, vol24h: 30_000, buys24h: 90, sells24h: 60, txns: 150 }), P("momentum")));
  assert.ok(!matches(tok({ changePct: 25, vol24h: 30_000, buys24h: 50, sells24h: 100, txns: 150 }), P("momentum"))); // sellers ahead
  assert.ok(matches(tok({ liquidity: 30_000, marketCap: 200_000 }), P("real")));
  assert.ok(!matches(tok({ liquidity: 30_000, marketCap: 1_000_000 }), P("real"))); // 3% of market cap
});

import { MEASURES, MORE, PRIMARY, QUICK, activeChips, clearChip, compact, compactAge, isCustom, isPreset, quickOn, toggleQuick } from "./userFilters.ts";
test("compact and compactAge round-trip through the parsers", () => {
  for (const n of [0, 5, 999, 1000, 25_000, 1_500_000, 2_000_000_000, -10]) assert.equal(parseAmount(compact(n)), n, String(n));
  for (const m of [5, 45, 60, 90, 120, 1440, 2880]) assert.equal(parseAge(compactAge(m)), m, String(m));
  assert.equal(compact(25_000), "25k");
  assert.equal(compact(1_500_000), "1.5m");
  assert.equal(compactAge(120), "2h");
});
test("every measure is shown exactly once (five up front, the rest under More), and every field is covered by a measure", () => {
  const ids = [...PRIMARY, ...MORE];
  assert.deepEqual([...ids].sort(), MEASURES.map((m) => m.id).sort());
  const keys = MEASURES.flatMap((m) => [m.lo, m.hi]);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of keys) assert.ok(k in EMPTY_FILTERS, String(k));
  assert.equal(keys.length, Object.keys(EMPTY_FILTERS).length - 2); // everything except q and dex
});
test("activeChips reads out what is on, and clearChip turns exactly that off", () => {
  const f = F({ minLiq: 25_000, minAgeMin: 5, maxAgeMin: 360, maxChange: -10, q: "frog", dex: ["cetus"] });
  assert.deepEqual(activeChips(f).map((c) => c.label), ["Search: frog", "Liquidity ≥ $25k", "24h change ≤ -10%", "Age 5 to 6h", "Exchange: Cetus"]);
  assert.equal(activeChips(f).length, activeCount(f));
  const g = clearChip(clearChip(f, "age"), "liq");
  assert.equal(g.minLiq, null);
  assert.equal(g.minAgeMin, null);
  assert.equal(g.maxAgeMin, null);
  assert.equal(g.maxChange, -10);
  assert.equal(clearChip(f, "q").q, "");
  assert.deepEqual(clearChip(f, "dex").dex, []);
  assert.equal(activeChips(EMPTY_FILTERS).length, 0);
});
test("isPreset only matches when the filters are exactly the preset", () => {
  const p = PRESETS[0];
  assert.ok(isPreset(F(p.f), p.f));
  assert.ok(!isPreset(F({ ...p.f, minVol: 1 }), p.f));
  assert.ok(!isPreset(EMPTY_FILTERS, p.f));
});

test("quick ranges: every measure has some, each sets a real range, and tapping toggles", () => {
  for (const m of MEASURES) assert.ok((QUICK[m.id] ?? []).length >= 2, m.id);
  for (const [id, qs] of Object.entries(QUICK)) {
    assert.ok(MEASURES.some((m) => m.id === id), id);
    assert.equal(new Set(qs.map((q) => q.label)).size, qs.length, `${id} labels`);
    for (const q of qs) assert.ok(q.lo !== undefined || q.hi !== undefined, `${id} ${q.label}`);
  }
  const liq = MEASURES.find((m) => m.id === "liq")!;
  const hundredK = QUICK.liq.find((q) => q.label === "$100K+")!;
  const on = toggleQuick(EMPTY_FILTERS, liq, hundredK);
  assert.equal(on.minLiq, 100_000);
  assert.equal(on.maxLiq, null);
  assert.ok(quickOn(on, liq, hundredK));
  const swapped = toggleQuick(on, liq, QUICK.liq[0]); // a different range replaces it
  assert.equal(swapped.minLiq, null);
  assert.equal(swapped.maxLiq, 10_000);
  assert.deepEqual(toggleQuick(on, liq, hundredK), EMPTY_FILTERS); // tapping again clears it
});
test("isCustom flags ranges that aren't a quick one, so the panel can show the boxes", () => {
  const liq = MEASURES.find((m) => m.id === "liq")!;
  assert.ok(!isCustom(EMPTY_FILTERS, liq));
  assert.ok(!isCustom(F({ minLiq: 100_000 }), liq));
  assert.ok(isCustom(F({ minLiq: 12_345 }), liq));
  assert.ok(isCustom(F({ minLiq: 100_000, maxLiq: 900_000 }), liq));
});
test("the quick chips filter what they say (edges inclusive)", () => {
  const age = MEASURES.find((m) => m.id === "age")!;
  const under6h = toggleQuick(EMPTY_FILTERS, age, QUICK.age[1]);
  assert.ok(matches(tok({ ageMin: 360 }), under6h) && !matches(tok({ ageMin: 361 }), under6h));
  const chg = MEASURES.find((m) => m.id === "chg")!;
  const falling = toggleQuick(EMPTY_FILTERS, chg, QUICK.chg[2]);
  assert.ok(matches(tok({ changePct: -3 }), falling) && !matches(tok({ changePct: 3 }), falling));
});

import { dexHue, dexLogoUrl, dexName } from "./dex.ts";
test("exchange names and logos: known ones get a real logo, the rest a badge", () => {
  assert.equal(dexName("pump-fun"), "pump.fun");
  assert.equal(dexName("letsbonk-fun"), "bonk.fun");
  assert.equal(dexName("some-new-dex"), "Some New Dex");
  assert.match(dexLogoUrl("pump-fun")!, /^https:\/\/dd\.dexscreener\.com\/ds-data\/dexes\/pumpfun\.png$/);
  assert.equal(dexLogoUrl("raydium-clmm"), "https://dd.dexscreener.com/ds-data/dexes/raydium.png");
  assert.equal(dexLogoUrl("zerofi"), null); // no real logo on file: lettered badge
  assert.equal(dexHue("pump-fun"), dexHue("pump-fun"));
  assert.ok(dexHue("pump-fun") >= 0 && dexHue("pump-fun") < 360);
});

test("the Genny preset keeps fast, established runners and drops everything else", () => {
  const g = F(PRESETS.find((p) => p.id === "genny")!.f);
  const runner = tok({ ageMin: 40, marketCap: 80_000, txns: 900 });
  assert.equal(matches(runner, g), true);
  assert.equal(matches(tok({ ageMin: 120, marketCap: 80_000, txns: 900 }), g), false); // too old
  assert.equal(matches(tok({ ageMin: 40, marketCap: 20_000, txns: 900 }), g), false); // too small
  assert.equal(matches(tok({ ageMin: 40, marketCap: 80_000, txns: 100 }), g), false); // too quiet
});
