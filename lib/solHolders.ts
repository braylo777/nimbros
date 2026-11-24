import { rpc, type RpcEnv } from "./solRpc.ts";

/* Who holds a coin, read from chain: the largest token accounts, resolved to their owner wallets. Pool vaults and
   other program-owned accounts show up as holders too (RPC can't tell them apart), so callers label these "top accounts". */

export interface Holder { address: string; raw: bigint }

export async function topHolders(env: RpcEnv | undefined, mint: string, limit = 20): Promise<Holder[]> {
  const big = await rpc<{ value: { address: string; amount: string }[] }>(env, "getTokenLargestAccounts", [mint, { commitment: "confirmed" }]);
  const accts = big.value.slice(0, limit);
  if (accts.length === 0) return [];
  const infos = await rpc<{ value: ({ data?: { parsed?: { info?: { owner?: string } } } } | null)[] }>(env, "getMultipleAccounts", [accts.map((a) => a.address), { encoding: "jsonParsed" }]);
  const byOwner = new Map<string, bigint>();
  accts.forEach((a, i) => {
    const owner = infos.value[i]?.data?.parsed?.info?.owner;
    if (typeof owner === "string" && /^\d+$/.test(a.amount)) byOwner.set(owner, (byOwner.get(owner) ?? 0n) + BigInt(a.amount));
  });
  return [...byOwner.entries()].map(([address, raw]) => ({ address, raw })).sort((a, b) => (a.raw === b.raw ? 0 : a.raw > b.raw ? -1 : 1));
}
