import { sha256 } from "./agentApi.ts";
import { formatUnits } from "./units.ts";
import type { Intent, InstantSession } from "./instant.ts";

/* Storage and lookups for instant mode (Workers KV). Small volume: a handful of intents per agent, each valid for 60 seconds. */

export interface KV { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> }

const parse = <T>(v: string | null, fallback: T): T => {
  try { return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};

export const getQueue = async (kv: KV, agentId: string) => parse<Intent[]>(await kv.get(`instant:q:${agentId}`), []);
export const putQueue = (kv: KV, agentId: string, q: Intent[]) => kv.put(`instant:q:${agentId}`, JSON.stringify(q), { expirationTtl: 3600 });
export const getAllow = async (kv: KV, agentId: string) => parse<string[]>(await kv.get(`instant:allow:${agentId}`), []);
export const putAllow = (kv: KV, agentId: string, owners: string[]) => kv.put(`instant:allow:${agentId}`, JSON.stringify(owners.slice(0, 5)));

export async function sessionFrom(kv: KV, header: string | null, now: number): Promise<InstantSession | null> {
  const m = /^Bearer (nbs_[0-9a-f]{32})$/.exec(header ?? "");
  if (!m) return null;
  const s = parse<InstantSession | null>(await kv.get(`instant:sess:${await sha256(m[1])}`), null);
  return s && s.exp > now ? s : null;
}

const GQL = "https://graphql.mainnet.sui.io/graphql";

/** The exact amount to sell: `pct` percent of the agent wallet's balance of the coin (100 = close), as a decimal string. */
export async function wholeBalance(coin: string, wallet: string, pct = 100): Promise<string | null> {
  try {
    const r = await fetch(GQL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "query($a:SuiAddress!,$t:String!){address(address:$a){balance(coinType:$t){totalBalance}} coinMetadata(coinType:$t){decimals}}",
        variables: { a: wallet, t: coin },
      }),
      signal: AbortSignal.timeout(6000),
    });
    const d = ((await r.json()) as { data?: { address?: { balance?: { totalBalance?: string } | null }; coinMetadata?: { decimals?: number } | null } }).data;
    const bal = d?.address?.balance?.totalBalance, dec = d?.coinMetadata?.decimals;
    if (!bal || !/^\d+$/.test(bal) || typeof dec !== "number") return null;
    const raw = (BigInt(bal) * BigInt(pct)) / 100n;
    return raw > 0n ? formatUnits(raw, dec) : null;
  } catch {
    return null;
  }
}
