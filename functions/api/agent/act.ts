import { act, authenticate } from "../../../lib/agentApi.ts";
import { depsFrom, json, type Env } from "../../../lib/agentHttp.ts";

/* POST /api/agent/act {op, ...} — an agent's price alerts, webhook, and wallet link.
   ops: cancel | alert | webhook | link_wallet | unlink_wallet */
export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const d = depsFrom(env);
  if (!d) return json({ error: "unavailable" }, 503);
  const a = await authenticate(d, request.headers.get("authorization"));
  if ("ok" in a) return json({ error: a.error }, a.status);
  try {
    const r = await act(d, a, (await request.json()) as Record<string, unknown>);
    return r.ok ? json(r) : json({ error: (r as { error: string }).error }, (r as { status: number }).status);
  } catch {
    return json({ error: "bad request" }, 400);
  }
}
