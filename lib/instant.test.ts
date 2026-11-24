import test from "node:test";
import assert from "node:assert/strict";
import { claim, enableMessage, enableWindowOk, enqueue, finish, validateIntent, MAX_PENDING, type Intent } from "./instant.ts";

const coin = "FrogMint1111111111111111111111111111111111";
const OWNER = "OwnerWa11et1111111111111111111111111111111";
const it = (o: Partial<Intent> = {}): Intent => ({ id: "a", owner: OWNER, side: "buy", coin, amount: "10", status: "pending", ts: 1000, ...o });

test("validateIntent accepts real requests and rejects junk", () => {
  assert.equal(validateIntent({ side: "buy", coin, amount: "10" }).ok, true);
  assert.equal(validateIntent({ side: "sell", coin, amount: "all" }).ok, true);
  assert.equal(validateIntent({ side: "buy", coin, amount: "all" }).ok, false);
  assert.equal(validateIntent({ side: "sell", coin, amount: "25%" }).ok, true);
  assert.equal(validateIntent({ side: "sell", coin, amount: "101%" }).ok, false);
  assert.equal(validateIntent({ side: "buy", coin, amount: "25%" }).ok, false);
  assert.equal(validateIntent({ side: "buy", coin, amount: "-1" }).ok, false);
  assert.equal(validateIntent({ side: "buy", coin, amount: "0" }).ok, false);
  assert.equal(validateIntent({ side: "buy", coin, amount: "999999" }).ok, false);
  assert.equal(validateIntent({ side: "buy", coin: "not a mint;bad", amount: "1" }).ok, false);
  assert.equal(validateIntent(null).ok, false);
});

test("the signed message and window are strict", () => {
  assert.equal(enableMessage("ag1", OWNER, 5), `nimbros-instant:ag1:${OWNER}:5`);
  assert.equal(enableWindowOk(2000, 1000), true);
  assert.equal(enableWindowOk(500, 1000), false);
  assert.equal(enableWindowOk(1000 + 26 * 3_600_000, 1000), false);
  assert.equal(enableWindowOk("x", 1000), false);
});

test("stale intents never run; fresh ones are claimed exactly once", () => {
  const q = [it({ id: "old", ts: 0 }), it({ id: "new", ts: 100_000 })];
  const r = claim(q, 100_000 + 1000);
  assert.deepEqual(r.run.map((x) => x.id), ["new"]);
  assert.equal(r.queue.find((x) => x.id === "old")!.status, "failed");
  assert.equal(claim(r.queue, 100_000 + 2000).run.length, 0);
});

test("finish only settles a claimed intent", () => {
  const q = [it({ status: "claimed" }), it({ id: "b", status: "pending" })];
  assert.equal(finish(q, "a", true, "dig")[0].status, "done");
  assert.equal(finish(q, "b", true)[1].status, "pending");
});

test("the queue refuses to pile up", () => {
  let q: Intent[] = [];
  for (let i = 0; i < MAX_PENDING; i++) {
    const r = enqueue(q, it({ id: String(i), ts: 1000 }), 1000);
    assert.ok(r.ok);
    if (r.ok) q = r.queue;
  }
  assert.equal(enqueue(q, it({ id: "x" }), 1000).ok, false);
});
