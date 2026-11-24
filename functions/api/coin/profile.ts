import { verifySolMessage } from "../../../lib/solVerify.ts";
import { creationSigner, getMintInfo, type RpcEnv } from "../../../lib/solRpc.ts";
import { COIN_TYPE } from "../../../lib/feeds.ts";
import { cleanProfile, profileMessage, type Profile } from "../../../lib/profile.ts";

/* GET  /api/coin/profile?coin=<mint> → the links a coin's creator published (X, website, Telegram, pairing)
   POST /api/coin/profile {coinType, address, profile, signature} → set them.
   Only the wallet that controls the coin's mint can write: the request must carry that wallet's
   ed25519 message signature over `nimbros-profile:<coinType>:<profile json>`. The authority is read from
   the chain, never from the request. Links are https-only and length-capped. */

interface KV { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> }
interface Env extends RpcEnv { FEEDS?: KV }
const json = (b: unknown, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": cache } });

export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const coin = new URL(request.url).searchParams.get("coin") ?? "";
  if (!COIN_TYPE.test(coin) || coin.length > 300) return json({ error: "bad coin" }, 400);
  let p: Profile = {};
  try { p = env.FEEDS ? (JSON.parse((await env.FEEDS.get(`profile:${coin}`)) ?? "{}") as Profile) : {}; } catch { /* none */ }
  return json(p, 200, "public, s-maxage=30, stale-while-revalidate=120");
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  try {
    if (!env.FEEDS) return json({ error: "unavailable" }, 503);
    const b = (await request.json()) as { coinType?: unknown; profile?: unknown; signature?: unknown };
    const coinType = b.coinType;
    if (typeof coinType !== "string" || !COIN_TYPE.test(coinType) || coinType.length > 300) return json({ error: "bad coinType" }, 400);
    if (typeof b.signature !== "string" || b.signature.length > 400) return json({ error: "signature required" }, 401);
    const profile = cleanProfile(b.profile);
    if (!profile) return json({ error: "bad profile" }, 400);

    /* Who may edit a coin's links: the wallet that created it (the fee payer of the mint's first transaction, read from chain) or the wallet holding its
       mint or freeze authority. Never taken from the request. */
    const [info, creator] = await Promise.all([getMintInfo(env, coinType).catch(() => null), creationSigner(env, coinType)]);
    if (!info) return json({ error: "coin not found" }, 422);
    const owners = [creator, info.mintAuthority, info.freezeAuthority].filter((x): x is string => !!x && x !== "authority-present");
    if (owners.length === 0) return json({ error: "we can't tell who created this coin, so its links can't be edited here" }, 403);
    let signer = "";
    const claimed = typeof (b as { address?: unknown }).address === "string" ? ((b as { address: string }).address) : "";
    try {
      signer = verifySolMessage(new TextEncoder().encode(profileMessage(coinType, profile)), b.signature, claimed);
    } catch {
      return json({ error: "bad signature" }, 401);
    }
    if (!owners.includes(signer)) return json({ error: "only the wallet that created this coin (or holds its mint key) can edit it" }, 403);
    await env.FEEDS.put(`profile:${coinType}`, JSON.stringify(profile));
    return json({ ok: true }, 201);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
