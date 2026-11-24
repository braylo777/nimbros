import { isSolAddress } from "../../../lib/chain.ts";
import { authenticate } from "../../../lib/agentApi.ts";
import { depsFrom, json, type Env } from "../../../lib/agentHttp.ts";
import { getAllow, putAllow } from "../../../lib/instantHttp.ts";

/* POST /api/instant/allow {owner, on?}  (agent API key)
   The agent's operator names the wallet address whose button clicks this agent may execute. Without this, nobody
   can queue trades for an agent, whatever they sign. `on:false` removes an address. */
export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const d = depsFrom(env);
  if (!d || !env.FEEDS) return json({ error: "unavailable" }, 503);
  const a = await authenticate(d, request.headers.get("authorization"));
  if ("ok" in a) return json({ error: a.error }, a.status);
  try {
    const b = (await request.json()) as { owner?: unknown; on?: unknown };
    const owner = typeof b.owner === "string" ? b.owner : "";
    if (!isSolAddress(owner)) return json({ error: "owner must be a Solana wallet address" }, 400);
    const cur = await getAllow(env.FEEDS, a.id);
    const next = b.on === false ? cur.filter((x) => x !== owner) : [...new Set([...cur, owner])];
    if (next.length > 5) return json({ error: "at most 5 owners per agent" }, 400);
    await putAllow(env.FEEDS, a.id, next);
    return json({ ok: true, owners: next });
  } catch {
    return json({ error: "bad request" }, 400);
  }
}
