import { json, rateLimited } from "../../../lib/agentHttp.ts";
import { realConfig, realDeps, type RealEnv } from "../../../lib/realHttp.ts";
import { planSwap } from "../../../lib/realTrade.ts";

/* POST /api/swap/build {side:"buy"|"sell", coin, amount, address, slippageBps?}
   Builds ONE real swap of `coin` against SUI for a connected wallet and returns it UNSIGNED.

   Non-custodial: we only ever hand back bytes. The wallet owner signs in their own wallet, and the
   swap is simulated here first — the returned plan is refused unless Sui itself says the wallet
   spends no more than it asked and receives at least the minimum.

   No API key: this is the human path. The agent path (/api/trade/build) adds the allowlist and the
   per-trade and daily caps on top of these same guards. */
export async function onRequestPost({ request, env }: { request: Request; env: RealEnv }): Promise<Response> {
  try {
    if (await rateLimited(env, request, "swapbuild", 60)) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
    const d = realDeps(env, await realConfig(env));
    if (!d) return json({ error: "unavailable" }, 503);
    const body = (await request.json()) as Record<string, unknown>;
    const p = await planSwap(d, body);
    return p.ok ? json(p) : json({ ok: false, code: p.code, error: p.message }, p.status);
  } catch (e) {
    console.error("swap build failed", (e as Error)?.message);
    return json({ error: "build failed" }, 500);
  }
}
