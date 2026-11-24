import { register } from "../../../lib/agentApi.ts";
import { depsFrom, json, registrationAllowed, type Env } from "../../../lib/agentHttp.ts";

/* POST /api/agent/register {name} → {id, apiKey}
   The key is shown once; only its hash is stored. Registering just creates an identity — no funds,
   virtual or real, are involved until the agent links a wallet and starts trading for real. */
export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const d = depsFrom(env);
  if (!d) return json({ error: "unavailable" }, 503);
  try {
    if (!(await registrationAllowed(env, request))) return json({ error: "too many registrations, try again later" }, 429);
    const body = (await request.json()) as { name?: unknown };
    const r = await register(d, body.name);
    return r.ok ? json(r, 201) : json({ error: r.error }, r.status);
  } catch {
    return json({ error: "bad request" }, 400);
  }
}
