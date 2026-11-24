import test from "node:test";
import assert from "node:assert/strict";
import { loadFeedRows, resetOwnPool } from "./feedClient.ts";

test.beforeEach(() => resetOwnPool()); // the browser pool is remembered between calls; each case starts clean

const mint = (s: string) => s.toUpperCase().padEnd(44, "1").slice(0, 44);
const row = (id: string) => ({ id: `gt:${id}`, kind: "snipe", live: true, ageMin: 90, name: id, ticker: id.toUpperCase(), price: 1, changePct: 12, marketCap: 0, liquidity: 9000, vol24h: 5000, txns: 50, contract: mint(id) });
const gtPool = (sym: string) => ({
  data: [{ attributes: { address: sym.padEnd(44, "1"), name: `${sym} / SOL`, base_token_price_usd: "0.01", reserve_in_usd: "5000", pool_created_at: new Date(Date.now() - 2 * 3600_000).toISOString(), price_change_percentage: { h24: "25" }, volume_usd: { h24: "5000" }, transactions: { h24: { buys: 30, sells: 30 } } },
    relationships: { base_token: { data: { id: "solana_" + mint(sym) } }, quote_token: { data: { id: "solana_So11111111111111111111111111111111111111112" } }, dex: { data: { id: "pump-fun" } } } }],
  included: [{ id: "solana_" + mint(sym), attributes: { symbol: sym, name: sym, image_url: "https://i.example/x.png" } }],
});
const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
type F = (u: string) => Promise<Response>;
const mk = (fn: F) => fn as unknown as typeof fetch;

test("a healthy server answer (a full list) is used as-is, with no direct calls", async () => {
  const urls: string[] = [];
  const many = Array.from({ length: 30 }, (_, i) => row(`c${i}`));
  const f = mk(async (u) => { urls.push(u); return res({ rows: many, ts: 5, sources: ["geckoterminal"] }); });
  const r = await loadFeedRows("snipe", f);
  assert.equal(r.rows.length, 30);
  assert.equal(urls.length, 1);
});
test("a thin server list is topped up from the browser's own read, and nothing is listed twice", async () => {
  const f = mk(async (u) => {
    if (u.startsWith("/api/feed")) return res({ rows: [row("mine"), row("shared")], ts: 5, sources: ["geckoterminal"] });
    if (u.includes("geckoterminal")) return res(gtPool("SHARED"));   // the browser also sees SHARED (same contract as the server's row)
    if (u.includes("dexscreener")) return res({ pairs: [] });
    return res({ data: {} });
  });
  const r = await loadFeedRows("snipe", f);
  const names = r.rows.map((t) => t.ticker).sort();
  assert.deepEqual(names, ["MINE", "SHARED"]);
  assert.ok(r.sources.includes("geckoterminal"));
});
test("server rate-limited -> the browser reads GeckoTerminal itself and the list still fills", async () => {
  const f = mk(async (u) => {
    if (u.startsWith("/api/feed")) return res({ error: "x" }, 503);
    if (u.includes("geckoterminal")) return res(gtPool("NEWCOIN"));
    if (u.includes("dexscreener")) return res({ pairs: [] });
    return res({ data: {} }); // anything else
  });
  const r = await loadFeedRows("snipe", f);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].ticker, "NEWCOIN");
  assert.deepEqual(r.sources, ["geckoterminal"]);
  assert.equal(r.stale, false);
});
test("server data built from the backup source is replaced by the browser's own newer read", async () => {
  const f = mk(async (u) => {
    if (u.startsWith("/api/feed")) return res({ rows: [row("old")], ts: 1, sources: ["dexscreener"], degraded: true });
    if (u.includes("geckoterminal")) return res(gtPool("FRESH"));
    if (u.includes("dexscreener")) return res({ pairs: [] });
    return res({ data: {} });
  });
  assert.equal((await loadFeedRows("snipe", f)).rows[0].ticker, "FRESH");
});
test("if the browser can't read either, degraded/stale server rows still beat an empty list", async () => {
  const f = mk(async (u) => (u.startsWith("/api/feed") ? res({ rows: [row("old")], ts: 1, sources: ["dexscreener"], degraded: true }) : res({}, 429)));
  const r = await loadFeedRows("snipe", f);
  assert.equal(r.rows[0].ticker, "OLD");
});
test("throws only when nothing at all is available", async () => {
  await assert.rejects(loadFeedRows("snipe", mk(async () => res({}, 429))));
});
test("scalp direct read drops stablecoins and thin pools", async () => {
  const p = gtPool("USDC");
  p.data[0].attributes.reserve_in_usd = "900000";
  const f = mk(async (u) => (u.startsWith("/api/feed") ? res({}, 503) : u.includes("geckoterminal") ? res(p) : res({ pairs: [], data: {} })));
  await assert.rejects(loadFeedRows("scalp", f)); // the only row is a stablecoin, so nothing remains
});

test("a slow server does not hold the list up: the browser's own read wins after the hedge delay", async () => {
  const f = mk(async (u) => {
    if (u.startsWith("/api/feed")) return new Promise<Response>(() => {}); // never answers
    if (u.includes("geckoterminal")) return res(gtPool("QUICK"));
    if (u.includes("dexscreener")) return res({ pairs: [] });
    return res({ data: {} });
  });
  const t = Date.now();
  const r = await loadFeedRows("snipe", f);
  assert.equal(r.rows[0].ticker, "QUICK");
  assert.ok(Date.now() - t < 2500);
});
