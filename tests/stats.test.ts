import test from "node:test";
import assert from "node:assert/strict";
import { compute, build } from "../scripts/stats.mjs";

const NOW = new Date("2026-11-24T12:00:00Z");
const coin = (dex?: string) => ({ ticker: "T", contract: "C", id: "i", name: "N", dex });
test("compute counts coins, distinct launchpads and volume", () => {
  const s = compute({ coins: [coin("pump.fun"), coin("pump.fun"), coin("Moonshot"), coin("meteora")] }, { vol24hUsd: 1234.567 }, NOW);
  assert.deepEqual(s, { launchpads: 3, coins_live: 4, vol_24h: 1234.57, as_of: "2026-11-24T12:00:00.000Z" });
});
test("launchpad names are compared case-insensitively and trimmed", () => assert.equal(compute({ coins: [coin("Pump.fun"), coin(" pump.fun ")] }, {}, NOW).launchpads, 1));
test("coins without a dex still count as live but not as a launchpad", () => { const s = compute({ coins: [coin(), coin("")] }, {}, NOW); assert.equal(s.coins_live, 2); assert.equal(s.launchpads, 0); });
for (const bad of [undefined, null, "x", -5, NaN, Infinity, {}]) {
  test(`bad volume ${String(bad)} becomes 0`, () => assert.equal(compute({ coins: [] }, { vol24hUsd: bad }, NOW).vol_24h, 0));
}
for (const body of [null, undefined, {}, { coins: "no" }, 5]) {
  test(`unusable coins body ${JSON.stringify(body)} gives zero coins`, () => assert.equal(compute(body, {}, NOW).coins_live, 0));
}
test("a bare array body is accepted", () => assert.equal(compute([coin("a"), coin("b")], {}, NOW).coins_live, 2));
test("as_of is an ISO timestamp", () => assert.match(compute({}, {}, NOW).as_of, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/));
test("build fetches both endpoints and strips a trailing slash", async () => {
  const seen: string[] = [];
  const f = (async (u: string) => { seen.push(u); return { ok: true, json: async () => (u.endsWith("/api/coins") ? { coins: [coin("a")] } : { vol24hUsd: 10 }) }; }) as never;
  const s = await build("https://x.test//", f, NOW);
  assert.deepEqual(seen.sort(), ["https://x.test/api/coins", "https://x.test/api/stats"]);
  assert.equal(s.vol_24h, 10);
});
test("build fails loudly when an endpoint is down", async () => {
  const f = (async () => ({ ok: false, status: 503 })) as never;
  await assert.rejects(() => build("https://x.test", f, NOW), /503/);
});
