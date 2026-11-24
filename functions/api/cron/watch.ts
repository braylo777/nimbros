import { depsFrom } from "../../../lib/agentHttp.ts";
import { scanWallet } from "../../../lib/shieldScan.ts";
import { newAlerts, remember } from "../../../lib/shieldWatch.ts";
import { json, store, type ShieldEnv } from "../../../lib/shieldHttp.ts";
import { deliver } from "../../../lib/webhook.ts";
import { INDEX_KEY, readWatch, watchKey } from "../shield/watch.ts";

/* POST /api/cron/watch — the background half of Sentinel. For every agent that watches wallets: scan each wallet, and if a NEW warn/block finding
   appeared since the last delivery, send a signed `shield_alert` to the agent's webhook. What was already announced is remembered only AFTER a
   successful delivery, so a receiver that is down gets the alert again next minute. Called by worker/cron with the shared secret. */

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
};

export async function onRequestPost({ request, env }: { request: Request; env: ShieldEnv }): Promise<Response> {
  const secret = env.CRON_SECRET ?? "";
  if (secret.length < 24 || !same(secret, request.headers.get("x-cron-secret") ?? "")) return json({ error: "forbidden" }, 403);
  const kv = store(env);
  const d = depsFrom(env);
  if (!kv || !d) return json({ error: "unavailable" }, 503);
  let ids: string[] = [];
  try { ids = JSON.parse((await kv.get(INDEX_KEY)) ?? "[]") as string[]; } catch { /* nothing watched */ }
  let scanned = 0, alerts = 0, failed = 0;
  for (const id of ids.slice(0, 200)) {
    const acct = await d.store.get(id);
    const list = await readWatch(env, id);
    if (!acct?.webhook || list.addresses.length === 0) continue;
    let changed = false;
    for (const address of list.addresses) {
      try {
        const scan = await scanWallet(env, address);
        scanned++;
        const fresh = newAlerts(list.seen[address] ?? [], scan.findings);
        if (fresh.length === 0) { list.seen[address] = remember(scan.findings); changed = true; continue; }
        const event = { id: `sa${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, t: Date.now(), type: "shield_alert", data: { address, level: scan.level, score: scan.score, findings: fresh, complete: scan.complete } };
        const left = await deliver(acct.webhook.url, acct.webhook.secret, [event]);
        if (left.length === 0) { list.seen[address] = remember(scan.findings); changed = true; alerts++; } else failed++;
      } catch {
        failed++;
      }
    }
    if (changed) await kv.put(watchKey(id), JSON.stringify(list));
  }
  return json({ ok: true, agents: ids.length, scanned, alerts, failed });
}
