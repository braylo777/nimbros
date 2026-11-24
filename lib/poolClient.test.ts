import test from "node:test";
import assert from "node:assert/strict";
import { loadPoolData } from "./poolClient.ts";

const POOL = "PooP1111111111111111111111111111111111111111";
const ohlcv = { data: { attributes: { ohlcv_list: [[200, 1, 2, 0.5, 1.5, 10], [100, 1, 1, 1, 1, 0]] } } };
const trades = { data: [{ attributes: { kind: "buy", block_timestamp: "2026-01-01T00:00:00Z", tx_hash: "H", to_token_amount: "5", price_to_in_usd: "2", volume_in_usd: "10" } }] };
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("uses the server when it has data, and never touches GeckoTerminal", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => { urls.push(u); return res({ candles: [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 0 }], trades: [] }); }) as unknown as typeof fetch;
  const d = await loadPoolData(POOL, "15m", f);
  assert.equal(d.via, "server");
  assert.equal(urls.length, 1);
  assert.ok(urls[0].startsWith("/api/pool"));
});
test("falls back to the browser asking GeckoTerminal directly when the server is rate-limited", async () => {
  const f = (async (u: string) => {
    if (u.startsWith("/api/pool")) return res({ error: "unavailable" }, 503);
    return u.includes("/ohlcv/") ? res(ohlcv) : res(trades);
  }) as unknown as typeof fetch;
  const d = await loadPoolData(POOL, "5m", f);
  assert.equal(d.via, "direct");
  assert.deepEqual(d.candles.map((c) => c.t), [100, 200]); // normalised and sorted
  assert.equal(d.trades.length, 1);
});
test("falls back when the server throws or returns an empty payload", async () => {
  const boom = (async (u: string) => { if (u.startsWith("/api/pool")) throw new Error("net"); return u.includes("/ohlcv/") ? res(ohlcv) : res(trades); }) as unknown as typeof fetch;
  assert.equal((await loadPoolData(POOL, "1H", boom)).via, "direct");
  const empty = (async (u: string) => (u.startsWith("/api/pool") ? res({ candles: [], trades: [] }) : u.includes("/ohlcv/") ? res(ohlcv) : res(trades))) as unknown as typeof fetch;
  assert.equal((await loadPoolData(POOL, "1H", empty)).via, "direct");
});
test("throws when both paths fail; one direct half failing is tolerated", async () => {
  const dead = (async () => res({}, 429)) as unknown as typeof fetch;
  await assert.rejects(loadPoolData(POOL, "1D", dead));
  const half = (async (u: string) => (u.startsWith("/api/pool") ? res({}, 503) : u.includes("/ohlcv/") ? res(ohlcv) : res({}, 429))) as unknown as typeof fetch;
  const d = await loadPoolData(POOL, "1D", half);
  assert.equal(d.candles.length, 2);
  assert.equal(d.trades.length, 0);
});
test("rejects a bad pool address or interval before making any request", async () => {
  let called = 0;
  const f = (async () => { called++; return res({}); }) as unknown as typeof fetch;
  await assert.rejects(loadPoolData("0xnope", "15m", f));
  await assert.rejects(loadPoolData(POOL, "7m" as never, f));
  assert.equal(called, 0);
});
