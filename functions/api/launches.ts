import { verifySolMessage } from "../../lib/solVerify.ts";
import { getMintInfo, type RpcEnv } from "../../lib/solRpc.ts";
import { lookup } from "../../lib/serverMarket.ts";
import { COIN_TYPE } from "../../lib/feeds.ts";
import { takenDown } from "../../lib/takedown.ts";

/* GET  /api/launches → newest-first list of coins registered on the NimBros launchpad
   POST /api/launches {coinType, agent?, signature?} → list a coin once it exists on Solana mainnet.

   NimBros never launches anything for anyone: launchers sign with their own wallet.
   A listing proves the coin exists on-chain (name, symbol and icon read from its live market listing,
   not from the request). An agent label is shown as verified only when `signature` is a
   personal-message signature over `nimbros-list:<coinType>:<agent>` made by the address
   that published the coin's package (read from the chain). Otherwise the coin is listed
   without a label. */

export interface Launch { coinType: string; symbol: string; name: string; icon?: string; agent?: string; creator?: string; t: number }
interface KV { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> }
interface Env extends RpcEnv { FEEDS?: KV }
const KEY = "launches:index";
const MAX = 200;
const json = (b: unknown, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": cache } });
const read = async (kv?: KV): Promise<Launch[]> => {
  try { const v = kv ? JSON.parse((await kv.get(KEY)) ?? "[]") : []; return Array.isArray(v) ? v : []; } catch { return []; }
};

export async function onRequestGet({ env }: { env: Env }): Promise<Response> {
  const all = await read(env.FEEDS);
  const shown = env.FEEDS ? (await Promise.all(all.map(async (x) => ((await takenDown(env.FEEDS!, { coinType: x.coinType, symbol: x.symbol })) ? null : x)))).filter((x): x is Launch => x !== null) : all;
  return json(shown, 200, "public, s-maxage=1, stale-while-revalidate=5"); // 1s edge cache: any number of watchers = ~1 read/s
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  try {
    if (!env.FEEDS) return json({ error: "unavailable" }, 503);
    const b = (await request.json()) as { coinType?: unknown; agent?: unknown; signature?: unknown };
    const coinType = b.coinType;
    if (typeof coinType !== "string" || !COIN_TYPE.test(coinType) || coinType.length > 300) return json({ error: "bad coinType" }, 400);
    const agent = typeof b.agent === "string" && /^[\x20-\x7E]{1,32}$/.test(b.agent) ? b.agent.trim() : undefined;
    if (await takenDown(env.FEEDS, { coinType })) return json({ error: "not available" }, 422);
    // the coin must really exist on Solana: name, symbol and icon come from its live market listing and the mint from chain, never from the request
    const [info, mkt] = await Promise.all([getMintInfo(env, coinType).catch(() => null), lookup(coinType)]);
    const m = mkt ? { symbol: mkt.ref.ticker, name: mkt.ref.name, iconUrl: mkt.ref.logo } : null;
    // a verified agent label needs a signature from the wallet that controls the mint
    const authority = info?.mintAuthority ?? info?.freezeAuthority ?? undefined;
    let creator: string | undefined;
    if (agent && authority && typeof b.signature === "string" && b.signature.length < 400) {
      try {
        verifySolMessage(new TextEncoder().encode(`nimbros-list:${coinType}:${agent}`), b.signature, authority);
        creator = authority;
      } catch { /* bad signature: list without a label */ }
    }
    if (!info || !m?.symbol) return json({ error: "coin not found on Solana mainnet" }, 422);
    const cur = await read(env.FEEDS);
    if (!cur.some((x) => x.coinType === coinType)) {
      const icon = m.iconUrl && m.iconUrl.startsWith("https://") && m.iconUrl.length <= 300 ? m.iconUrl : undefined;
      cur.unshift({ coinType, symbol: m.symbol.slice(0, 12), name: (m.name ?? m.symbol).slice(0, 40), icon, agent: creator ? agent : undefined, creator, t: Date.now() });
      await env.FEEDS.put(KEY, JSON.stringify(cur.slice(0, MAX)));
    }
    return json({ ok: true, verified: creator !== undefined }, 201);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
