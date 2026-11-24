import { WSOL_MINT } from "./chain.ts";
import { tokenFacts } from "./tokenIndex.ts";

/* Server-side Solana JSON-RPC. `url` comes from the SOLANA_RPC_URL secret (a Helius/Triton/QuickNode endpoint);
   the free public node is the fallback so the app works out of the box, at a lower rate limit. */

export const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
export interface RpcEnv { SOLANA_RPC_URL?: string }
export const rpcUrl = (env?: RpcEnv) => (env?.SOLANA_RPC_URL && env.SOLANA_RPC_URL.startsWith("https://") ? env.SOLANA_RPC_URL : PUBLIC_RPC);

export async function rpc<T>(env: RpcEnv | undefined, method: string, params: unknown[], timeoutMs = 8000): Promise<T> {
  const r = await fetch(rpcUrl(env), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`rpc ${r.status}`);
  const j = (await r.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "rpc error");
  return j.result as T;
}

/** The wallet that paid for and signed the transaction that created this mint, read from chain. Null when it can't be established (a mint with a
    very long history, or a node that refuses indexed reads): the caller then falls back to the mint authorities only. */
export async function creationSigner(env: RpcEnv | undefined, mint: string): Promise<string | null> {
  try {
    const sigs = await rpc<{ signature: string; err: unknown }[]>(env, "getSignaturesForAddress", [mint, { limit: 1000, commitment: "confirmed" }], 10000);
    if (sigs.length === 0 || sigs.length >= 1000) return null;
    const oldest = sigs[sigs.length - 1];
    if (oldest.err !== null) return null;
    const t = await rpc<{ transaction: { message: { accountKeys: ({ pubkey: string } | string)[] } } } | null>(env, "getTransaction", [oldest.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }], 10000);
    const k = t?.transaction.message.accountKeys[0];
    return typeof k === "string" ? k : k?.pubkey ?? null;
  } catch {
    return null;
  }
}

export interface MintInfo {
  decimals: number;
  supply: string; // raw, as a decimal string
  mintAuthority: string | null;
  freezeAuthority: string | null;
  /** the token program that owns the mint (Tokenkeg or Token-2022) */
  program: string;
}

/** Marks "an authority exists" when only a yes/no answer is available (the token index says whether one exists, not whose it is). */
export const UNKNOWN_AUTHORITY = "authority-present";

/** The same facts from the keyless token index, used when no RPC node is configured or none answers. Enough for decimals and the two authority checks. */
async function mintInfoFromIndex(mint: string): Promise<MintInfo | null> {
  const f = await tokenFacts(mint);
  // an answer we can't read is not "revoked": both authority flags must be known
  if (!f || f.mintDisabled === undefined || f.freezeDisabled === undefined) return null;
  const supply = f.supply !== undefined && f.supply > 0 ? (BigInt(Math.floor(f.supply)) * 10n ** BigInt(f.decimals)).toString() : "";
  return {
    decimals: f.decimals,
    supply,
    mintAuthority: f.mintDisabled ? null : UNKNOWN_AUTHORITY,
    freezeAuthority: f.freezeDisabled ? null : UNKNOWN_AUTHORITY,
    program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  };
}

/** A mint's own facts: read from chain when a node is configured (SOLANA_RPC_URL), otherwise (or if the node fails) from the token index. null if unreadable. */
export async function getMintInfo(env: RpcEnv | undefined, mint: string): Promise<MintInfo | null> {
  if (mint === WSOL_MINT) return { decimals: 9, supply: "0", mintAuthority: null, freezeAuthority: null, program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" };
  if (env?.SOLANA_RPC_URL) {
    try {
      return await mintInfoFromNode(env, mint);
    } catch {
      /* fall through to the index */
    }
  }
  return mintInfoFromIndex(mint).catch(() => null);
}

async function mintInfoFromNode(env: RpcEnv | undefined, mint: string): Promise<MintInfo | null> {
  const res = await rpc<{ value: { owner: string; data: { parsed?: { type?: string; info?: Record<string, unknown> } } } | null }>(env, "getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const v = res.value;
  const info = v?.data?.parsed?.info;
  if (!v || v.data?.parsed?.type !== "mint" || !info) return null;
  const dec = info.decimals;
  if (typeof dec !== "number") return null;
  return {
    decimals: dec,
    supply: typeof info.supply === "string" ? info.supply : "0",
    mintAuthority: typeof info.mintAuthority === "string" ? info.mintAuthority : null,
    freezeAuthority: typeof info.freezeAuthority === "string" ? info.freezeAuthority : null,
    program: v.owner,
  };
}
