import { isSolAddress } from "../../../lib/chain.ts";
import { getMintInfo, type RpcEnv } from "../../../lib/solRpc.ts";

/* Public, stateless: how many decimals a Solana token mint uses, read from the mint account itself.
   Used by the client to turn a raw on-chain balance into a sellable percentage — never guessed. */

const cache = new Map<string, number>();

export async function onRequestGet({ request, env }: { request: Request; env: RpcEnv }): Promise<Response> {
  const h = { "content-type": "application/json", "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" };
  const coin = new URL(request.url).searchParams.get("coin");
  if (!isSolAddress(coin)) return new Response(JSON.stringify({ error: "coin required" }), { status: 400, headers: h });

  const cached = cache.get(coin);
  if (cached !== undefined) return new Response(JSON.stringify({ decimals: cached }), { headers: h });
  try {
    const info = await getMintInfo(env, coin);
    if (!info) return new Response(JSON.stringify({ error: "unknown coin" }), { status: 404, headers: h });
    cache.set(coin, info.decimals);
    return new Response(JSON.stringify({ decimals: info.decimals }), { headers: h });
  } catch {
    return new Response(JSON.stringify({ error: "lookup failed" }), { status: 503, headers: h });
  }
}
