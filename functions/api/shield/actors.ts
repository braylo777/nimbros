import { isSolAddress } from "../../../lib/chain.ts";
import { json, loadActors, saveActors, type ShieldEnv } from "../../../lib/shieldHttp.ts";

/* Scam-actor watchlist: wallets and deployers known to drain or rug people.
   GET  /api/shield/actors            → the public list (address, label, reason, source)
   POST /api/shield/actors {address, label, reason, source}   header x-cron-secret → add or update an entry; {address, remove:true} removes it.
   Empty until someone adds evidence-backed entries: nothing here is invented, and every entry must name its source. */

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
};

export async function onRequestGet({ env }: { env: ShieldEnv }): Promise<Response> {
  return json({ actors: await loadActors(env) }, 200, "public, s-maxage=60, stale-while-revalidate=300");
}

export async function onRequestPost({ request, env }: { request: Request; env: ShieldEnv }): Promise<Response> {
  const secret = env.CRON_SECRET ?? "";
  if (secret.length < 24 || !same(secret, request.headers.get("x-cron-secret") ?? "")) return json({ error: "forbidden" }, 403);
  let b: { address?: unknown; label?: unknown; reason?: unknown; source?: unknown; remove?: unknown };
  try { b = (await request.json()) as typeof b; } catch { return json({ error: "bad json" }, 400); }
  if (!isSolAddress(b.address)) return json({ error: "address must be a Solana address" }, 400);
  const list = (await loadActors(env)).filter((a) => a.address !== b.address);
  if (b.remove !== true) {
    const t = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const label = t(b.label, 60), reason = t(b.reason, 200), source = t(b.source, 200);
    if (!label || !reason || !source) return json({ error: "label, reason and source are all required" }, 400);
    list.unshift({ address: b.address, label, reason, source, ts: Date.now() });
  }
  return (await saveActors(env, list)) ? json({ ok: true, count: list.length }) : json({ error: "unavailable" }, 503);
}
