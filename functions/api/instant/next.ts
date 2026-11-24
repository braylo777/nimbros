import { authenticate } from "../../../lib/agentApi.ts";
import { depsFrom, json, type Env } from "../../../lib/agentHttp.ts";
import { claim, finish } from "../../../lib/instant.ts";
import { getQueue, putQueue, wholeBalance } from "../../../lib/instantHttp.ts";

/* GET  /api/instant/next          (agent API key) → the trades the agent should run now, each claimed exactly once.
        A sell of "all" is turned into the exact balance of the agent's linked wallet.
   POST /api/instant/next {id, ok, digest?, note?} (agent API key) → the agent reports how one turned out. */
export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const d = depsFrom(env);
  if (!d || !env.FEEDS) return json({ error: "unavailable" }, 503);
  const a = await authenticate(d, request.headers.get("authorization"));
  if ("ok" in a) return json({ error: a.error }, a.status);
  let q = await getQueue(env.FEEDS, a.id);
  if (q.length === 0) return json({ trades: [] });
  const c = claim(q, Date.now());
  q = c.queue;
  const trades: { id: string; side: string; coin: string; amount: string }[] = [];
  for (const i of c.run) {
    let amount = i.amount;
    if (amount === "all" || amount.endsWith("%")) {
      const w = a.wallet ? await wholeBalance(i.coin, a.wallet, amount === "all" ? 100 : Number(amount.slice(0, -1))) : null;
      if (!w) {
        q = finish(q, i.id, false, undefined, a.wallet ? "Your agent holds none of that coin." : "Your agent has no linked wallet.");
        continue;
      }
      amount = w;
    }
    trades.push({ id: i.id, side: i.side, coin: i.coin, amount });
  }
  await putQueue(env.FEEDS, a.id, q);
  return json({ trades });
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const d = depsFrom(env);
  if (!d || !env.FEEDS) return json({ error: "unavailable" }, 503);
  const a = await authenticate(d, request.headers.get("authorization"));
  if ("ok" in a) return json({ error: a.error }, a.status);
  try {
    const b = (await request.json()) as { id?: unknown; ok?: unknown; digest?: unknown; note?: unknown };
    if (typeof b.id !== "string") return json({ error: "id required" }, 400);
    const digest = typeof b.digest === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(b.digest) ? b.digest : undefined;
    const note = typeof b.note === "string" ? b.note.replace(/[^\x20-\x7E]/g, "").slice(0, 200) : undefined;
    await putQueue(env.FEEDS, a.id, finish(await getQueue(env.FEEDS, a.id), b.id, b.ok === true, digest, note));
    return json({ ok: true });
  } catch {
    return json({ error: "bad request" }, 400);
  }
}
