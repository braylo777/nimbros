import type { D1 } from "../../lib/accountStore.ts";
import { COIN_TYPE } from "../../lib/feeds.ts";
import { json } from "../../lib/agentHttp.ts";

/* GET  /api/views          → {coin: count} for every coin someone on NimBros is looking at right now (seen in the last 60 s)
   POST /api/views {coin,sid} → "I'm looking at this coin": one row per browser tab, refreshed every 30 s.
   Counts only tabs on this site. No account, IP or cookie is stored; the tab id is random and lives in memory. */
interface Env { DB?: D1 }
const WINDOW_MS = 60_000;

export async function onRequestGet({ env }: { env: Env }): Promise<Response> {
  if (!env.DB) return json({}, 200, "public, s-maxage=10");
  try {
    const r = await env.DB.prepare("SELECT coin, COUNT(*) AS n FROM coin_views WHERE ts > ?1 GROUP BY coin").bind(Date.now() - WINDOW_MS).all<{ coin: string; n: number }>();
    const out: Record<string, number> = {};
    for (const x of r.results) out[x.coin] = x.n;
    return json(out, 200, "public, s-maxage=10, stale-while-revalidate=20");
  } catch {
    return json({}, 200, "no-store");
  }
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (!env.DB) return json({ ok: false }, 503);
  try {
    const b = (await request.json()) as { coin?: unknown; sid?: unknown };
    const coin = typeof b.coin === "string" ? b.coin : "";
    const sid = typeof b.sid === "string" ? b.sid : "";
    if (!COIN_TYPE.test(coin) || !/^[a-z0-9]{8,24}$/.test(sid)) return json({ error: "bad request" }, 400);
    const now = Date.now();
    await env.DB.prepare("INSERT INTO coin_views (coin, sid, ts) VALUES (?1, ?2, ?3) ON CONFLICT(coin, sid) DO UPDATE SET ts = ?3").bind(coin, sid, now).run();
    if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM coin_views WHERE ts < ?1").bind(now - 10 * 60_000).run();
    return json({ ok: true });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
