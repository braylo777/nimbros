import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import bs58 from "bs58";
import { memoryStore } from "./accountStore.ts";
import { memoryLedger } from "./realLedger.ts";
import { act, authenticate, platformStats, register, tick, type Account, type Deps } from "./agentApi.ts";
import type { Market } from "./serverMarket.ts";
import { normType } from "./tradingview.ts";

const COIN = "FrogMint1111111111111111111111111111111111";

/** A throwaway Solana wallet: the address is the base58 ed25519 public key; signatures are over the raw message bytes. */
const newWallet = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const address = bs58.encode(Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url"));
  return { address, signMsg: (m: string) => edSign(null, Buffer.from(m), privateKey).toString("base64") };
};

function setup(price = 1, sol = 1) {
  let p = price;
  const clock = { t: 1_000_000 };
  const market = (): Market => ({ price: p, depth: { liquidityUsd: 1_000_000, reserveBase: 500_000 / p, reserveQuoteUsd: 500_000 }, ref: { id: "gt:pool", contract: COIN, ticker: "FROG", name: "Frog" }, change24h: 0, liquidity: 1_000_000 });
  const d: Deps = {
    store: memoryStore<Account>(),
    now: () => clock.t,
    rand: () => Math.random().toString(16).slice(2).padEnd(32, "0"),
    lookup: async (c) => (normType(c) === normType(COIN) ? market() : null),
    marks: async (cs) => new Map(cs.map((c) => [normType(c), p])),
    solUsd: async () => sol,
  };
  return { d, clock, setPrice: (x: number) => (p = x), adv: (ms: number) => (clock.t += ms) };
}
const reg = async (d: Deps, name = "bot-1") => { const r = await register(d, name); assert.ok(r.ok); return r as Extract<typeof r, { ok: true }>; };
const acct = async (d: Deps, key: string) => { const a = await authenticate(d, `Bearer ${key}`); assert.ok("id" in a); return a as Account; };
const fresh = async (d: Deps, id: string) => (await d.store.get(id))!;
const status = (x: unknown) => (x as { status: number }).status;

test("register hands back a key once, stores only its hash, rejects duplicates and bad names", async () => {
  const { d } = setup();
  const r = await reg(d);
  assert.match(r.apiKey, /^nbk_[0-9a-f]{32}$/);
  assert.equal(status(await register(d, "BOT-1")), 409);
  assert.equal(status(await register(d, "x")), 400);
  assert.equal(status(await authenticate(d, "Bearer nbk_" + "0".repeat(32))), 401);
  assert.equal(status(await authenticate(d, null)), 401);
  assert.equal(((await authenticate(d, `Bearer ${r.apiKey}`)) as Account).id, r.id);
  assert.ok(!JSON.stringify(await d.store.get(r.id)).includes(r.apiKey));
});

test("the store refuses a save based on stale data", async () => {
  const s = setup();
  const r = await reg(s.d);
  const one = await fresh(s.d, r.id), two = await fresh(s.d, r.id);
  assert.equal(await s.d.store.save({ ...one, active: true }), true);
  assert.equal(await s.d.store.save({ ...two, active: false }), false);
  assert.equal((await fresh(s.d, r.id)).active, true);
});

test("linking a wallet needs a signature from that wallet over this agent's own message", async () => {
  const s = setup();
  const r = await reg(s.d, "walleted"), other = await reg(s.d, "other");
  const kp = newWallet(), kp2 = newWallet();
  const sign = async (k: ReturnType<typeof newWallet>, id: string) => k.signMsg(`nimbros-link:${id}`);
  const link = async (key: string, body: object) => act(s.d, await acct(s.d, key), { op: "link_wallet", ...body });

  assert.equal(status(await link(r.apiKey, {})), 400);                                             // no signature
  assert.equal(status(await link(r.apiKey, { signature: await sign(kp, r.id) })), 400);           // no address: a Solana address IS the key, so it can't be recovered from the signature
  assert.equal(status(await link(r.apiKey, { signature: "not-a-signature", address: kp.address })), 422);   // junk
  assert.equal(status(await link(r.apiKey, { signature: await sign(kp, other.id), address: kp.address })), 422);       // signed for a different agent
  assert.equal(status(await link(r.apiKey, { signature: await sign(kp, r.id), address: kp2.address })), 422); // address doesn't match the signer

  const ok = (await link(r.apiKey, { signature: await sign(kp, r.id), address: kp.address })) as unknown as { ok: true; wallet: string };
  assert.ok(ok.ok);
  assert.equal(ok.wallet, kp.address);
  assert.equal((await fresh(s.d, r.id)).wallet, kp.address);

  assert.equal(status(await link(other.apiKey, { signature: await sign(kp, r.id), address: kp.address })), 422);      // a signature made for `r` can't be reused by another agent (the message differs)
  assert.equal(status(await link(other.apiKey, { signature: await sign(kp, other.id), address: kp.address })), 409);  // a valid signature, but that wallet already belongs to `r`
  const c = await reg(s.d, "third");
  assert.equal(status(await link(c.apiKey, { signature: await sign(kp, c.id), address: kp.address })), 409);          // the same wallet can't serve two agents

  assert.ok((await act(s.d, await acct(s.d, r.apiKey), { op: "unlink_wallet" })).ok);
  assert.equal((await fresh(s.d, r.id)).wallet, undefined);
  assert.ok((await link(c.apiKey, { signature: await sign(kp, c.id), address: kp.address })).ok);                      // free to link elsewhere once unlinked
});

test("server-side alerts fire once, then the account drops off the active list", async () => {
  const s = setup(1);
  const r = await reg(s.d);
  assert.ok((await act(s.d, await acct(s.d, r.apiKey), { op: "alert", coin: COIN, dir: "above", price: 1.5 })).ok);
  assert.equal((await tick(s.d)).alerts, 0);
  s.setPrice(1.6);
  assert.equal((await tick(s.d)).alerts, 1);
  assert.equal((await tick(s.d)).accounts, 0); // nothing left to watch
});

test("an alert can be cancelled by id, and cancelling an unknown id is a 404", async () => {
  const s = setup(1);
  const r = await reg(s.d);
  const made = (await act(s.d, await acct(s.d, r.apiKey), { op: "alert", coin: COIN, dir: "above", price: 1.5 })) as unknown as { ok: true; alert: { id: string } };
  assert.ok(made.ok);
  assert.equal(status(await act(s.d, await acct(s.d, r.apiKey), { op: "cancel", id: "nope" })), 404);
  assert.ok((await act(s.d, await acct(s.d, r.apiKey), { op: "cancel", id: made.alert.id })).ok);
  assert.equal((await fresh(s.d, r.id)).alerts.length, 0);
});

test("webhooks: only public https, events are signed and delivered, failures are retried", async () => {
  const s = setup(1);
  const r = await reg(s.d);
  assert.equal(status(await act(s.d, await acct(s.d, r.apiKey), { op: "webhook", url: "http://insecure.example.com/x" })), 422);
  const set = (await act(s.d, await acct(s.d, r.apiKey), { op: "webhook", url: "https://hooks.example.com/nb" })) as unknown as { ok: true; secret: string };
  assert.ok(set.ok && set.secret.startsWith("nbsec_"));

  const sent: { url: string; type: string }[] = [];
  let fail = true;
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string, o: RequestInit) => { sent.push({ url: u, type: (o.headers as Record<string, string>)["x-nimbros-event"] }); return new Response(null, { status: fail ? 500 : 204 }); }) as unknown as typeof fetch;
  try {
    await act(s.d, await acct(s.d, r.apiKey), { op: "alert", coin: COIN, dir: "above", price: 1.5 }); // above the current price: won't fire yet
    await tick(s.d);
    assert.equal((await fresh(s.d, r.id)).outbox.length, 0);
    s.setPrice(1.6);
    await tick(s.d); // fires, and the same pass attempts delivery: receiver is down, kept for retry
    assert.equal((await fresh(s.d, r.id)).outbox.length, 1);
    assert.equal((await fresh(s.d, r.id)).outbox[0].tries, 1);
    await tick(s.d); // retried, still down
    assert.equal((await fresh(s.d, r.id)).outbox[0].tries, 2);
    fail = false;
    const rep = await tick(s.d);
    assert.equal(rep.delivered, 1);
    assert.equal((await fresh(s.d, r.id)).outbox.length, 0);
    assert.deepEqual(sent.map((x) => x.type), ["alert", "alert", "alert"]);
    assert.equal(sent[0].url, "https://hooks.example.com/nb");
  } finally { globalThis.fetch = real; }
  // an agent with no webhook queues nothing
  const q = await reg(s.d, "quiet");
  await act(s.d, await acct(s.d, q.apiKey), { op: "alert", coin: COIN, dir: "above", price: 0.5 });
  await tick(s.d);
  assert.equal((await fresh(s.d, q.id)).outbox.length, 0);
});

test("removing the webhook clears the outbox too", async () => {
  const s = setup(1);
  const r = await reg(s.d);
  await act(s.d, await acct(s.d, r.apiKey), { op: "webhook", url: "https://hooks.example.com/nb" });
  await act(s.d, await acct(s.d, r.apiKey), { op: "alert", coin: COIN, dir: "above", price: 0.5 });
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
  try { await tick(s.d); } finally { globalThis.fetch = real; }
  assert.equal((await fresh(s.d, r.id)).outbox.length, 1);
  const cleared = await act(s.d, await acct(s.d, r.apiKey), { op: "webhook", url: null });
  assert.ok(cleared.ok);
  assert.equal((await fresh(s.d, r.id)).outbox.length, 0);
});

test("platformStats reads the real ledger only: settled trades, everything windowed to 24h", async () => {
  const ledger = memoryLedger();
  const now = 100_000_000;
  await ledger.add({ id: "1", ts: now - 90_000_000, agentId: "a", address: "0xaa", kind: "reported", usd: 10, detail: {} }); // old
  await ledger.add({ id: "2", ts: now - 1_000, agentId: "a", address: "0xaa", kind: "reported", usd: 40, detail: {} });      // recent, same trader
  await ledger.add({ id: "3", ts: now - 1_000, agentId: "b", address: "0xbb", kind: "reported", usd: 60, detail: {} });      // recent, second trader
  await ledger.add({ id: "4", ts: now - 1_000, agentId: "a", address: "0xaa", kind: "reserve", usd: 999, detail: {} });      // not settled: excluded entirely
  const stats = await platformStats(ledger, now);
  assert.equal(stats.agentTxns, 2);      // settled rows inside the last 24h only (the old one and the unsettled reserve are out)
  assert.equal(stats.activeAgents, 2);   // distinct addresses with a settled trade in the last 24h
  assert.equal(stats.vol24hUsd, 100);    // only the two rows inside the last 24h
});

test("alerts don't depend on a SOL price at all: they trigger straight off the dollar prices in the token lists", async () => {
  const s = setup(1);
  const r = await reg(s.d);
  const noSol: Deps = { ...s.d, solUsd: async () => null };
  assert.ok((await act(noSol, await acct(noSol, r.apiKey), { op: "alert", coin: COIN, dir: "above", price: 0.5 })).ok);
  assert.equal((await tick(noSol)).alerts, 1); // fires immediately: price 1 is already above 0.5
});
