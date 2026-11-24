import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SORT, naturalSort, nextSort, sortRows, type SortState } from "./sortRows.ts";
import { MOVER_MIN_LIQ, marketStats, topMovers } from "./marketStats.ts";
import type { Token } from "./types.ts";

const tok = (o: Partial<Token>): Token => ({ id: "gt:a", kind: "snipe", name: "Aa", ticker: "A", price: 1, changePct: 0, marketCap: 0, liquidity: 10_000, vol24h: 5_000, txns: 10, contract: "0xa::a::A", ...o });
const ids = (rows: Token[]) => rows.map((r) => r.id);

test("defaults: Snipe is newest first, Scalp is busiest first", () => {
  assert.deepEqual(DEFAULT_SORT.snipe, { key: "new", dir: "asc" });
  assert.deepEqual(DEFAULT_SORT.agent, { key: "vol", dir: "desc" });
});
test("sortRows orders by each key in both directions, and unknowns go last either way", () => {
  const rows = [
    tok({ id: "b", name: "Beta", marketCap: 2, changePct: 5, liquidity: 300, vol24h: 30, ageMin: 90, buys24h: 3, sells24h: 1 }),
    tok({ id: "a", name: "alpha", marketCap: 1, changePct: -2, liquidity: 100, vol24h: 90, ageMin: 10, buys24h: 1, sells24h: 3 }),
    tok({ id: "c", name: "Gamma", marketCap: 3, changePct: 9, liquidity: 200, vol24h: 60 }), // no age, no trade counts
  ];
  const by = (key: SortState["key"], dir: SortState["dir"]) => ids(sortRows(rows, { key, dir }));
  assert.deepEqual(by("new", "asc"), ["a", "b", "c"]);   // newest first, unknown age last
  assert.deepEqual(by("new", "desc"), ["b", "a", "c"]);  // oldest first, unknown age still last
  assert.deepEqual(by("name", "asc"), ["a", "b", "c"]);  // case-insensitive
  assert.deepEqual(by("mcap", "desc"), ["c", "b", "a"]);
  assert.deepEqual(by("chg", "desc"), ["c", "b", "a"]);
  assert.deepEqual(by("liq", "asc"), ["a", "c", "b"]);
  assert.deepEqual(by("vol", "desc"), ["a", "c", "b"]);
  assert.deepEqual(by("bp", "desc"), ["b", "a", "c"]);   // buy pressure unknown for c: last
  assert.deepEqual(by("bp", "asc"), ["a", "b", "c"]);
});
test("sortRows is stable on ties and doesn't change its input", () => {
  const rows = [tok({ id: "z", liquidity: 5 }), tok({ id: "y", liquidity: 5 }), tok({ id: "x", liquidity: 5 })];
  const before = ids(rows);
  assert.deepEqual(ids(sortRows(rows, { key: "liq", dir: "desc" })), ["x", "y", "z"]);
  assert.deepEqual(ids(rows), before);
});
test("nextSort: the same column flips, a new one starts in its natural direction", () => {
  assert.deepEqual(nextSort({ key: "vol", dir: "desc" }, "vol"), { key: "vol", dir: "asc" });
  assert.deepEqual(nextSort({ key: "vol", dir: "asc" }, "vol"), { key: "vol", dir: "desc" });
  assert.deepEqual(nextSort({ key: "vol", dir: "desc" }, "new"), { key: "new", dir: "asc" });
  assert.deepEqual(nextSort({ key: "vol", dir: "desc" }, "name"), { key: "name", dir: "asc" });
  assert.deepEqual(nextSort({ key: "new", dir: "asc" }, "chg"), { key: "chg", dir: "desc" });
});
test("marketStats counts each coin once, sums volume, and finds the top mover", () => {
  const rows = [
    tok({ id: "1", contract: "0x1::a::A", dex: "cetus", vol24h: 1000, changePct: 10, liquidity: 9000 }),
    tok({ id: "1b", contract: "0x1::a::A", dex: "bluefin", vol24h: 500, changePct: 10, liquidity: 20_000 }), // same coin, other pool
    tok({ id: "2", contract: "0x2::b::B", dex: "cetus", vol24h: 2000, changePct: 40, liquidity: 8000 }),
    tok({ id: "3", contract: "0x3::c::C", dex: "turbos-finance", vol24h: 300, changePct: 900, liquidity: 100 }),   // huge move on dust: ignored
  ];
  const s = marketStats(rows);
  assert.equal(s.coins, 3);
  assert.equal(s.exchanges, 2); // the duplicate row's exchange isn't counted, matching how the coin is counted
  assert.equal(s.volume24h, 3300);
  assert.equal(s.topMover?.contract, "0x2::b::B");
  assert.deepEqual(marketStats([]), { coins: 0, exchanges: 0, volume24h: 0, topMover: null });
});
test("topMovers needs liquidity and trading behind a move, keeps one row per coin, and caps the list", () => {
  const rows = Array.from({ length: 20 }, (_, i) => tok({ id: `m${i}`, contract: `0x${i}::m::M`, changePct: i, liquidity: MOVER_MIN_LIQ + i, vol24h: 5000 }));
  rows.push(tok({ id: "thin", contract: "0xff::t::T", changePct: 5000, liquidity: MOVER_MIN_LIQ - 1 }));
  rows.push(tok({ id: "quiet", contract: "0xfe::q::Q", changePct: 4000, vol24h: 10 }));
  const top = topMovers(rows, 8);
  assert.equal(top.length, 8);
  assert.equal(top[0].id, "m19");
  assert.ok(!top.some((t) => t.id === "thin" || t.id === "quiet"));
});

test("naturalSort: text and age start ascending, numbers start with the biggest", () => {
  assert.deepEqual(naturalSort("new"), { key: "new", dir: "asc" });
  assert.deepEqual(naturalSort("name"), { key: "name", dir: "asc" });
  for (const k of ["chg", "liq", "vol", "bp", "mcap"] as const) assert.equal(naturalSort(k).dir, "desc", k);
});

test("a broken price (a five-million-percent 'run') never becomes a mover", () => {
  const rows = [
    tok({ id: "bad", contract: "0x1::b::B", liquidity: 50_000, vol24h: 50_000, changePct: 537_206_617 }),
    tok({ id: "ok", contract: "0x2::o::O", liquidity: 50_000, vol24h: 50_000, changePct: 80 }),
  ];
  assert.deepEqual(topMovers(rows, 5).map((t) => t.id), ["ok"]);
});
