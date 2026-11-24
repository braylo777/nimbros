import { tick } from "../../../lib/agentApi.ts";
import { depsFrom, json, type Env } from "../../../lib/agentHttp.ts";

/* POST /api/cron/tick — check price alerts and deliver queued webhooks.
   Called by the scheduled worker (worker/cron) with a shared secret; refuses everyone else. */
const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
};

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const secret = env.CRON_SECRET ?? "";
  const given = request.headers.get("x-cron-secret") ?? "";
  if (secret.length < 24 || !same(secret, given)) return json({ error: "forbidden" }, 403);
  const d = depsFrom(env);
  if (!d) return json({ error: "unavailable" }, 503);
  try {
    return json(await tick(d));
  } catch {
    return json({ error: "tick failed" }, 500);
  }
}
