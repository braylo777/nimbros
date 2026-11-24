import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import bs58 from "bs58";
import { onRequestGet, onRequestPost } from "../functions/api/launches.ts";
import { takenDown } from "./takedown.ts";

const C = "FrogMint1111111111111111111111111111111111";
const T = "ToadMint1111111111111111111111111111111111";
const kv = () => { const m = new Map<string, string>(); return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) }; };
const post = (env: object, b: object) => onRequestPost({ request: new Request("https://x", { method: "POST", body: JSON.stringify(b) }), env });

const wallet = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  return { address: bs58.encode(raw), sign: (msg: string) => sign(null, Buffer.from(msg), privateKey).toString("base64") };
};

/** One mock for both upstreams: Solana RPC (the mint account) and DexScreener (name, symbol, logo). */
const upstream = (coin: string | null, meta?: { symbol: string; name: string; logo?: string }, mintAuthority?: string) => {
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("dexscreener")) {
      if (!coin || !meta) return new Response(JSON.stringify({ pairs: [] }));
      return new Response(JSON.stringify({ pairs: [{ chainId: "solana", pairAddress: "Pool1111111111111111111111111111111111111111", dexId: "pump-fun", baseToken: { address: coin, name: meta.name, symbol: meta.symbol }, quoteToken: { symbol: "SOL" }, priceUsd: "0.01", liquidity: { usd: 9000, base: 1 }, info: { imageUrl: meta.logo } }] }));
    }
    if (!coin) return new Response(JSON.stringify({ result: { value: null } }));
    return new Response(JSON.stringify({ result: { value: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: { parsed: { type: "mint", info: { decimals: 6, supply: "1000", mintAuthority: mintAuthority ?? null, freezeAuthority: null } } } } } }));
  }) as unknown as typeof fetch;
};

test("lists a coin that exists, reading its details from the market feed, newest first, no duplicates", async () => {
  const env = { FEEDS: kv(), SOLANA_RPC_URL: "https://rpc.test" };
  upstream(C, { symbol: "FROG", name: "Sol Frog", logo: "https://e.com/i.png" });
  assert.equal((await post(env, { coinType: C, agent: "bot-1" })).status, 201);
  await post(env, { coinType: C });
  upstream(T, { symbol: "TOAD", name: "Toad", logo: "http://insecure/i.png" });
  await post(env, { coinType: T });
  const l = (await (await onRequestGet({ env })).json()) as { symbol: string; icon?: string; agent?: string }[];
  assert.deepEqual(l.map((x) => x.symbol), ["TOAD", "FROG"]);
  assert.equal(l[0].icon, undefined);
  assert.equal(l[1].agent, undefined); // no signature -> no label
});
test("refuses unknown coins and bad input", async () => {
  const env = { FEEDS: kv(), SOLANA_RPC_URL: "https://rpc.test" };
  upstream(null);
  assert.equal((await post(env, { coinType: C })).status, 422);
  assert.equal((await post(env, { coinType: "nope" })).status, 400);
  assert.deepEqual(await (await onRequestGet({ env })).json(), []);
});

test("agent label is shown only when signed by the wallet that controls the coin's mint", async () => {
  const owner = wallet(), other = wallet();
  const msg = `nimbros-list:${C}:bot-1`;
  const run = async (sig: string) => {
    const env = { FEEDS: kv(), SOLANA_RPC_URL: "https://rpc.test" };
    upstream(C, { symbol: "FROG", name: "Sol Frog" }, owner.address);
    const res = (await (await post(env, { coinType: C, agent: "bot-1", signature: sig })).json()) as { verified: boolean };
    const l = (await (await onRequestGet({ env })).json()) as { agent?: string; creator?: string }[];
    return { res, row: l[0] };
  };
  const ok = await run(owner.sign(msg));
  assert.equal(ok.res.verified, true);
  assert.equal(ok.row.agent, "bot-1");
  assert.equal(ok.row.creator, owner.address);
  const bad = await run(other.sign(msg)); // signed by someone who does not control the mint
  assert.equal(bad.res.verified, false);
  assert.equal(bad.row.agent, undefined);
  const junk = await run("not-a-signature");
  assert.equal(junk.res.verified, false);
});

test("taken-down coins and symbols are hidden from the feed and can't be listed", async () => {
  const env = { FEEDS: kv(), SOLANA_RPC_URL: "https://rpc.test" };
  upstream(C, { symbol: "FROG", name: "Sol Frog" });
  await post(env, { coinType: C });
  upstream(T, { symbol: "TOAD", name: "Toad" });
  await post(env, { coinType: T });
  await env.FEEDS.put("takedown:coin:" + C, "1");
  const l = (await (await onRequestGet({ env })).json()) as { symbol: string }[];
  assert.deepEqual(l.map((x) => x.symbol), ["TOAD"]);
  assert.equal((await post(env, { coinType: C })).status, 422);
  await env.FEEDS.put("takedown:sym:TOAD", "1");
  assert.deepEqual(await (await onRequestGet({ env })).json(), []);
  assert.equal(await takenDown({ get: async () => { throw new Error("kv down"); } }, { symbol: "X" }), false);
});
