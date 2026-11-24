import type { D1 } from "./accountStore.ts";

/** Adds one to a named counter that resets when its window (ttlMs) has passed, and returns the new count. */
export async function bump(db: D1, key: string, ttlMs: number, now = Date.now()): Promise<number> {
  await db
    .prepare("INSERT INTO counters (k, n, exp) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN exp < ?3 THEN 1 ELSE n + 1 END, exp = CASE WHEN exp < ?3 THEN ?2 ELSE exp END")
    .bind(key, now + ttlMs, now)
    .run();
  const r = await db.prepare("SELECT n FROM counters WHERE k = ?1").bind(key).first<{ n: number }>();
  return r?.n ?? 1;
}
