import { COIN_TYPE } from "../../lib/feeds.ts";
import { summarizeSafety } from "../../lib/safety.ts";
import { getMintInfo, type RpcEnv } from "../../lib/solRpc.ts";

/* GET /api/safety?coin=<mint address> — read-only on-chain checks, straight from the mint account.
   The mint address is strictly validated (base58, 32-44 chars) before it goes into an RPC call. */
export async function onRequestGet({ request, env }: { request: Request; env: RpcEnv }): Promise<Response> {
  const coin = new URL(request.url).searchParams.get("coin") ?? "";
  if (!COIN_TYPE.test(coin)) return new Response("bad request", { status: 400 });
  try {
    const s = summarizeSafety(coin, await getMintInfo(env, coin));
    if (!s) throw new Error("bad");
    return new Response(JSON.stringify(s), { headers: { "content-type": "application/json", "cache-control": "public, s-maxage=120" } });
  } catch {
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
}
