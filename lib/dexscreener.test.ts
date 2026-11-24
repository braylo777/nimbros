import test from "node:test";
import assert from "node:assert/strict";
import { enrich, fallbackRows, parsePairs, reservesOf, socialsOf } from "./dexscreener.ts";
import type { Token } from "./types.ts";

const pair = (o: Record<string, unknown> = {}) => ({
  chainId: "solana", pairAddress: "Pool1111111111111111111111111111111111111111", dexId: "pump-fun",
  baseToken: { address: "AaaMint1111111111111111111111111111111111", name: "Aaa Coin", symbol: "AAA" },
  quoteToken: { address: "So11111111111111111111111111111111111111112", symbol: "SOL" },
  priceUsd: "2", priceChange: { h24: 5 },
  txns: { h24: { buys: 10, sells: 6 } }, volume: { h24: 1234 },
  liquidity: { usd: 100_000, base: 25_000, quote: 1 },
  marketCap: 500_000, pairCreatedAt: Date.now() - 3_600_000,
  info: { imageUrl: "https://cdn.example/a.png" },
  ...o,
});

test("parsePairs maps a Solana pair with reserves", () => {
  const [p] = parsePairs({ pairs: [pair()] });
  assert.equal(p.token.ticker, "AAA");
  assert.equal(p.token.price, 2);
  assert.equal(p.token.id, "gt:Pool1111111111111111111111111111111111111111");
  assert.equal(p.token.txns, 16);
  assert.equal(p.token.logo, "https://cdn.example/a.png");
  // base 25,000 x $2 = $50,000 of $100,000 total -> $50,000 on the other side
  assert.deepEqual(p.reserves, { base: 25_000, quoteUsd: 50_000 });
});
test("parsePairs drops other chains, bad prices and malformed rows", () => {
  assert.equal(parsePairs({ pairs: [pair({ chainId: "sui" })] }).length, 0);
  assert.equal(parsePairs({ pairs: [pair({ priceUsd: "0" })] }).length, 0);
  assert.equal(parsePairs({ pairs: [pair({ baseToken: {} })] }).length, 0);
  assert.equal(parsePairs({ pairs: [null, "x", 5] }).length, 0);
  assert.equal(parsePairs(null).length, 0);
});
test("parsePairs accepts a bare array and non-https logos are dropped", () => {
  const [p] = parsePairs([pair({ info: { imageUrl: "http://x/a.png" } })]);
  assert.equal(p.token.logo, undefined);
});
test("reservesOf refuses numbers that don't hang together", () => {
  assert.equal(reservesOf(100, 200, 1), undefined); // base worth more than the whole pool
  assert.equal(reservesOf(100, 100, 1), undefined); // nothing left on the other side
  assert.equal(reservesOf(0, 1, 1), undefined);
  assert.equal(reservesOf(undefined, 1, 1), undefined);
  assert.equal(reservesOf(100, -1, 1), undefined);
  assert.deepEqual(reservesOf(100, 25, 2), { base: 25, quoteUsd: 50 });
});
test("enrich fills gaps and adds reserves, never overwrites live price/volume", () => {
  const rows: Token[] = [{
    id: "gt:Pool1111111111111111111111111111111111111111", kind: "snipe", live: true, name: "Aaa", ticker: "AAA",
    price: 1.9, changePct: 1, marketCap: 0, liquidity: 99_000, vol24h: 1000, txns: 5,
    contract: "AaaMint1111111111111111111111111111111111",
  } as Token];
  const [t] = enrich(rows, parsePairs({ pairs: [pair()] }));
  assert.equal(t.price, 1.9);        // primary wins
  assert.equal(t.vol24h, 1000);      // primary wins
  assert.equal(t.marketCap, 500_000); // gap filled
  assert.equal(t.reserveBase, 25_000);
  assert.equal(t.reserveQuoteUsd, 50_000);
  assert.equal(enrich(rows, [])[0].reserveBase, undefined);
});
test("fallbackRows applies the caller's gate and keeps the deepest pool per coin", () => {
  const deep = pair({ pairAddress: "Deep11111111111111111111111111111111111111", liquidity: { usd: 200_000, base: 25_000 } });
  const thin = pair({ pairAddress: "Thin11111111111111111111111111111111111111", liquidity: { usd: 1_000, base: 100 } });
  const all = parsePairs({ pairs: [thin, deep] });
  const rows = fallbackRows(all, "agent", (t) => t.liquidity >= 500);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].liquidity, 200_000);
  assert.equal(rows[0].kind, "agent");
  assert.equal(fallbackRows(all, "snipe", () => false).length, 0);
});

test("socialsOf keeps only https links, tags them, and dedupes", () => {
  const s = socialsOf({
    socials: [
      { type: "Twitter", url: "https://x.com/a" },
      { type: "telegram", url: "https://t.me/a" },
      { type: "twitter", url: "https://x.com/a" }, // duplicate url, dropped
      { type: "discord", url: "http://insecure.example" }, // not https, dropped
    ],
    websites: [{ label: "Website", url: "https://proj.example" }],
  });
  assert.deepEqual(s.map((x) => x.type), ["twitter", "telegram", "website"]);
  assert.deepEqual(s.map((x) => x.url), ["https://x.com/a", "https://t.me/a", "https://proj.example"]);
});

test("socialsOf survives hostile or missing input and never returns junk links", () => {
  assert.deepEqual(socialsOf(undefined), []);
  assert.deepEqual(socialsOf({ socials: "not-an-array" }), []);
  assert.deepEqual(socialsOf({ socials: [null, 5, {}, { url: "javascript:alert(1)" }] }), []);
  // a link with no usable type still renders, labelled generically
  assert.deepEqual(socialsOf({ socials: [{ type: "123", url: "https://ok.example" }] }), [{ type: "link", url: "https://ok.example" }]);
});

test("socialsOf caps the list so one pair can't flood the UI", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ type: "twitter", url: `https://x.com/${i}` }));
  assert.equal(socialsOf({ socials: many }).length, 6);
});

test("a parsed pair reports whether the project publishes any links", () => {
  const withLinks = parsePairs({ pairs: [pair({ info: { socials: [{ type: "twitter", url: "https://x.com/a" }] } })] });
  assert.equal(withLinks[0].token.hasSocial, true);
  assert.equal(withLinks[0].token.socials?.length, 1);
  const without = parsePairs({ pairs: [pair()] });
  assert.equal(without[0].token.hasSocial, false); // checked and found none, not unknown
  assert.deepEqual(without[0].token.socials, []);
});
