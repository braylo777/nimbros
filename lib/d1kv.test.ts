import test from "node:test";
import assert from "node:assert/strict";
import { d1Kv } from "./d1kv.ts";
import type { D1 } from "./accountStore.ts";

/** A tiny in-memory stand-in for the one table d1Kv uses. */
function fakeD1(): D1 {
  const rows = new Map<string, { v: string; exp: number }>();
  return {
    prepare(q: string) {
      let args: unknown[] = [];
      const st = {
        bind(...a: unknown[]) { args = a; return st; },
        async first() { const r = rows.get(args[0] as string); return r ? ({ ...r } as never) : null; },
        async all() { return { results: [] as never[] }; },
        async run() { if (q.startsWith("INSERT")) rows.set(args[0] as string, { v: args[1] as string, exp: args[2] as number }); return { meta: { changes: 1 } }; },
      };
      return st as never;
    },
  };
}

test("get returns what put stored, and put overwrites", async () => {
  const kv = d1Kv(fakeD1());
  assert.equal(await kv.get("a"), null);
  await kv.put("a", "1");
  await kv.put("a", "2");
  assert.equal(await kv.get("a"), "2");
});
test("a value past its ttl reads as missing; without a ttl it never expires", async () => {
  let t = 1_000_000;
  const kv = d1Kv(fakeD1(), () => t);
  await kv.put("short", "x", { expirationTtl: 60 });
  await kv.put("forever", "y");
  t += 59_000;
  assert.equal(await kv.get("short"), "x");
  t += 2_000;
  assert.equal(await kv.get("short"), null);
  assert.equal(await kv.get("forever"), "y");
});
