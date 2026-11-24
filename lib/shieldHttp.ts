import { rpc, type RpcEnv } from "./solRpc.ts";
import { PROGRAMS, type TokenAcct } from "./shield.ts";
import { d1Kv } from "./d1kv.ts";
import type { D1 } from "./accountStore.ts";

/* Server-side helpers shared by the Shield and Track endpoints. */

interface KV { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> }
export interface ShieldEnv extends RpcEnv { DB?: D1; FEEDS?: KV; CRON_SECRET?: string }

export const store = (env: ShieldEnv): KV | undefined => (env.DB ? d1Kv(env.DB) : env.FEEDS);

export interface Actor { address: string; label: string; reason: string; source: string; ts: number }
const ACTORS_KEY = "watch:actors";

/** The scam-wallet watchlist. Empty until someone adds entries (POST /api/shield/actors): NimBros never ships invented "known drainer" addresses. */
export async function loadActors(env: ShieldEnv): Promise<Actor[]> {
  try {
    const j = JSON.parse((await store(env)?.get(ACTORS_KEY)) ?? "[]") as unknown;
    return Array.isArray(j) ? (j as Actor[]).filter((a) => typeof a?.address === "string") : [];
  } catch {
    return [];
  }
}
export async function saveActors(env: ShieldEnv, list: Actor[]): Promise<boolean> {
  const kv = store(env);
  if (!kv) return false;
  await kv.put(ACTORS_KEY, JSON.stringify(list.slice(0, 5000)));
  return true;
}

interface ParsedAcct {
  pubkey: string;
  account: { data: { parsed?: { info?: { mint?: string; state?: string; delegate?: string; delegatedAmount?: { amount?: string }; closeAuthority?: string; tokenAmount?: { amount?: string; decimals?: number } } } } };
}

/** Every token account the wallet owns (both token programs), parsed. Needs a node that allows indexed reads: throws otherwise. */
export async function tokenAccounts(env: ShieldEnv, owner: string): Promise<TokenAcct[]> {
  const out: TokenAcct[] = [];
  for (const program of [PROGRAMS.token, PROGRAMS.token22]) {
    const r = await rpc<{ value: ParsedAcct[] }>(env, "getTokenAccountsByOwner", [owner, { programId: program }, { encoding: "jsonParsed", commitment: "confirmed" }], 12000);
    for (const a of r.value) {
      const i = a.account.data.parsed?.info;
      if (!i?.mint || !i.tokenAmount) continue;
      out.push({
        pubkey: a.pubkey, mint: i.mint, program, amount: i.tokenAmount.amount ?? "0", decimals: i.tokenAmount.decimals ?? 0,
        delegate: i.delegate, delegatedAmount: i.delegatedAmount?.amount, frozen: i.state === "frozen", closeAuthority: i.closeAuthority,
      });
    }
  }
  return out;
}

export interface Sig { signature: string; ts: number; ok: boolean }
export async function recentSignatures(env: ShieldEnv, address: string, limit = 15): Promise<Sig[]> {
  const r = await rpc<{ signature: string; blockTime: number | null; err: unknown }[]>(env, "getSignaturesForAddress", [address, { limit, commitment: "confirmed" }], 10000);
  return r.map((s) => ({ signature: s.signature, ts: (s.blockTime ?? 0) * 1000, ok: s.err === null }));
}

export const json = (b: unknown, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": cache } });
