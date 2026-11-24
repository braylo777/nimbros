import type { D1 } from "./accountStore.ts";

/* A KV-shaped store on D1, for values that are rewritten often. Same get/put as Workers KV (with expirationTtl), backed by the `blobs`
   table, so callers written for KV work unchanged and D1's much larger free write allowance applies instead. */
export interface KVLike {
  get(k: string): Promise<string | null>;
  put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>;
}

export function d1Kv(db: D1, now: () => number = Date.now): KVLike {
  return {
    async get(k) {
      const r = await db.prepare("SELECT v, exp FROM blobs WHERE k = ?1").bind(k).first<{ v: string; exp: number }>();
      if (!r || (r.exp !== 0 && r.exp < now())) return null;
      return r.v;
    },
    async put(k, v, o) {
      const exp = o?.expirationTtl ? now() + o.expirationTtl * 1000 : 0;
      await db.prepare("INSERT INTO blobs (k, v, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, exp = ?3").bind(k, v, exp).run();
    },
  };
}
