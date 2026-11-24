import { json } from "../../../lib/agentHttp.ts";
import { enqueue, validateIntent, type Intent } from "../../../lib/instant.ts";
import { getQueue, putQueue, sessionFrom, type KV } from "../../../lib/instantHttp.ts";

/* POST /api/instant/intent {side, coin, amount|"all"}  (Bearer session token)  → queue one trade for the owner's agent.
   GET  /api/instant/intent?id=<id>                      (Bearer session token)  → its status.
   Nothing here moves funds: it only leaves a note that the agent picks up, checks and executes with its own key,
   under its own caps. A note left unclaimed for 60 seconds is dropped. */
export async function onRequestPost({ request, env }: { request: Request; env: { FEEDS?: KV } }): Promise<Response> {
  if (!env.FEEDS) return json({ error: "unavailable" }, 503);
  const now = Date.now();
  const s = await sessionFrom(env.FEEDS, request.headers.get("authorization"), now);
  if (!s) return json({ error: "Instant mode isn't on. Turn it on again." }, 401);
  try {
    const v = validateIntent(await request.json());
    if (!v.ok) return json({ error: v.error }, 400);
    const i: Intent = {
      id: [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, "0")).join(""),
      owner: s.owner, side: v.side, coin: v.coin, amount: v.amount, status: "pending", ts: now,
    };
    const q = await enqueue(await getQueue(env.FEEDS, s.agentId), i, now);
    if (!q.ok) return json({ error: q.error }, 429);
    await putQueue(env.FEEDS, s.agentId, q.queue);
    return json({ ok: true, id: i.id });
  } catch {
    return json({ error: "bad request" }, 400);
  }
}

export async function onRequestGet({ request, env }: { request: Request; env: { FEEDS?: KV } }): Promise<Response> {
  if (!env.FEEDS) return json({ error: "unavailable" }, 503);
  const s = await sessionFrom(env.FEEDS, request.headers.get("authorization"), Date.now());
  if (!s) return json({ error: "Instant mode isn't on." }, 401);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const i = (await getQueue(env.FEEDS, s.agentId)).find((x) => x.id === id && x.owner === s.owner);
  if (!i) return json({ error: "not found" }, 404);
  const stale = i.status === "pending" && Date.now() - i.ts > 60_000;
  return json({ status: stale ? "failed" : i.status, digest: i.digest, note: stale ? "Your agent wasn't listening. Run: nimbros instant" : i.note });
}
