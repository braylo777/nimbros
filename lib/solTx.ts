import { WSOL_MINT } from "./chain.ts";
import { rpc, type RpcEnv } from "./solRpc.ts";

/* Reads one finished transaction from chain and boils it down to what the signer's wallet actually gained and lost.
   Nothing in a request is trusted: signer, success, time and every balance change come from the node. */

export interface TxSummary {
  ok: boolean;
  signer: string;
  ts: number; // ms epoch (0 if the node doesn't know)
  /** the signer's native SOL change in lamports (negative = spent), network fee included */
  solDelta: bigint;
  /** net token changes for the signer, by mint (WSOL excluded: it is folded into SOL) */
  tokens: { mint: string; raw: bigint }[];
}

interface Parsed {
  blockTime: number | null;
  meta: {
    err: unknown;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: { owner?: string; mint: string; uiTokenAmount: { amount: string } }[];
    postTokenBalances?: { owner?: string; mint: string; uiTokenAmount: { amount: string } }[];
  } | null;
  transaction: { message: { accountKeys: ({ pubkey: string; signer: boolean } | string)[] } };
}

export async function txSummary(env: RpcEnv | undefined, signature: string): Promise<TxSummary | null> {
  const t = await rpc<Parsed | null>(env, "getTransaction", [signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
  if (!t || !t.meta) return null;
  const k0 = t.transaction.message.accountKeys[0];
  const signer = typeof k0 === "string" ? k0 : k0.pubkey;
  const net = new Map<string, bigint>();
  const add = (mint: string, v: bigint) => net.set(mint, (net.get(mint) ?? 0n) + v);
  for (const b of t.meta.postTokenBalances ?? []) if (b.owner === signer && b.mint !== WSOL_MINT) add(b.mint, BigInt(b.uiTokenAmount.amount));
  for (const b of t.meta.preTokenBalances ?? []) if (b.owner === signer && b.mint !== WSOL_MINT) add(b.mint, -BigInt(b.uiTokenAmount.amount));
  return {
    ok: t.meta.err === null,
    signer,
    ts: t.blockTime ? t.blockTime * 1000 : 0,
    solDelta: BigInt(t.meta.postBalances[0] ?? 0) - BigInt(t.meta.preBalances[0] ?? 0),
    tokens: [...net.entries()].filter(([, v]) => v !== 0n).map(([mint, raw]) => ({ mint, raw })),
  };
}
