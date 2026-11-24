import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequestPost } from "../functions/api/peg.ts";

const kv = () => { const m = new Map<string, string>(); return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) }; };

test("GET lists registered pegs (none yet on Solana)", async () => {
  assert.deepEqual(await (await onRequestGet({ env: { FEEDS: kv() } })).json(), {});
});
test("registering a peg is not available until the Solana launch flow exists", async () => {
  assert.equal((await onRequestPost()).status, 501);
});
