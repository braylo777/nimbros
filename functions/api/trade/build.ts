import { authenticate } from "../../../lib/agentApi.ts";
import { depsFrom, json } from "../../../lib/agentHttp.ts";
import { realConfig, realDeps, type RealEnv } from "../../../lib/realHttp.ts";
import { planTrade } from "../../../lib/realTrade.ts";

/* POST /api/trade/build {side:"buy"|"sell", coin, amount, address, slippageBps?}
   Builds and simulates ONE real swap of `coin` against SUI and returns it UNSIGNED. The agent signs with
   its own key. Off by default; needs an approved, linked wallet; capped per trade and per 24 hours.
     buy:  amount = SUI to spend     sell: amount = coins to sell (plain decimal) */
export async function onRequestPost({ request, env }: { request: Request; env: RealEnv }): Promise<Response> {
  const a = depsFrom(env);
  if (!a) return json({ error: "unavailable" }, 503);
  const agent = await authenticate(a, request.headers.get("authorization"));
  if ("ok" in agent) return json({ error: agent.error }, agent.status);
  try {
    const d = realDeps(env, await realConfig(env));
    if (!d) return json({ error: "unavailable" }, 503);
    const p = await planTrade(d, { id: agent.id, wallet: agent.wallet }, (await request.json()) as Record<string, unknown>);
    return p.ok ? json(p) : json({ ok: false, code: p.code, error: p.message }, p.status);
  } catch (e) {
    console.error("trade build failed", (e as Error)?.message);
    return json({ error: "build failed" }, 500);
  }
}
