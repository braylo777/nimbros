import { authenticate } from "../../../lib/agentApi.ts";
import { depsFrom } from "../../../lib/agentHttp.ts";
import { isSolAddress } from "../../../lib/chain.ts";
import { emptyWatch, withAddress, type WatchList } from "../../../lib/shieldWatch.ts";
import { json, store, type ShieldEnv } from "../../../lib/shieldHttp.ts";

/* Sentinel in the background. An agent (Bearer key) asks NimBros to watch up to 5 wallets; every minute the scheduler scans them and POSTs a signed
   `shield_alert` event to the agent's webhook when a NEW warn/block finding appears (a fresh approval, a coin turning dangerous, the wallet landing on the
   scam watchlist). Read-only and non-custodial: it only ever tells you.
   GET  /api/shield/watch                    → the watched wallets
   POST /api/shield/watch {address, on?:bool} → watch (default) or stop watching one wallet. Needs a webhook set first (`set_webhook`). */

export const watchKey = (agentId: string) => `sw:${agentId}`;
export const INDEX_KEY = "sw:index";

export async function readWatch(env: ShieldEnv, agentId: string): Promise<WatchList> {
  try {
    const j = JSON.parse((await store(env)?.get(watchKey(agentId))) ?? "null") as WatchList | null;
    return j && Array.isArray(j.addresses) ? { addresses: j.addresses.filter(isSolAddress), seen: j.seen ?? {} } : emptyWatch();
  } catch {
    return emptyWatch();
  }
}

async function who(env: ShieldEnv & { CRON_SECRET?: string }, request: Request) {
  const d = depsFrom(env);
  if (!d) return { err: json({ error: "unavailable" }, 503) };
  const a = await authenticate(d, request.headers.get("authorization"));
  if ("ok" in a) return { err: json({ error: a.error }, a.status) };
  return { acct: a };
}

export async function onRequestGet({ request, env }: { request: Request; env: ShieldEnv }): Promise<Response> {
  const r = await who(env, request);
  if (r.err) return r.err;
  return json({ addresses: (await readWatch(env, r.acct.id)).addresses });
}

export async function onRequestPost({ request, env }: { request: Request; env: ShieldEnv }): Promise<Response> {
  const r = await who(env, request);
  if (r.err) return r.err;
  const kv = store(env);
  if (!kv) return json({ error: "unavailable" }, 503);
  let b: { address?: unknown; on?: unknown };
  try { b = (await request.json()) as typeof b; } catch { return json({ error: "bad json" }, 400); }
  if (!isSolAddress(b.address)) return json({ error: "address must be a Solana wallet address" }, 400);
  const on = b.on !== false;
  if (on && !r.acct.webhook) return json({ error: "Set a webhook first (set_webhook): alerts are delivered there." }, 409);
  const res = withAddress(await readWatch(env, r.acct.id), b.address, on);
  if (!res.ok) return json({ error: res.message }, 422);
  await kv.put(watchKey(r.acct.id), JSON.stringify(res.list));
  try {
    const idx = new Set(JSON.parse((await kv.get(INDEX_KEY)) ?? "[]") as string[]);
    if (res.list.addresses.length > 0) idx.add(r.acct.id); else idx.delete(r.acct.id);
    await kv.put(INDEX_KEY, JSON.stringify([...idx].slice(0, 2000)));
  } catch { /* the index is rebuilt on the next change */ }
  return json({ ok: true, addresses: res.list.addresses });
}
