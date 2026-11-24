import { isSolAddress } from "../../lib/chain.ts";
import { rpc, type RpcEnv } from "../../lib/solRpc.ts";

/* GET /api/snipers?pool=<pool address>&coin=<mint> → who got in first, and do they still hold?
   Reads the pool's earliest transactions from Solana, takes the first distinct wallets that touched it (the pool's
   creator excluded), and reads how much of the coin each still holds. "Snipers" here means the first
   SNIPERS wallets in; it says nothing about intent. A pool too busy to read its opening (more history than one RPC page)
   or with no readable early history comes back unchecked, never guessed. */

const SNIPERS = 10;
const EARLY_TXS = 24;
const h = { "content-type": "application/json", "cache-control": "public, s-maxage=300, stale-while-revalidate=900" };

export async function onRequestGet({ request, env }: { request: Request; env: RpcEnv }): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const pool = sp.get("pool") ?? "", coin = sp.get("coin") ?? "";
  if (!isSolAddress(pool) || !isSolAddress(coin)) return new Response(JSON.stringify({ error: "bad request" }), { status: 400, headers: h });
  const unchecked = (reason: string) => new Response(JSON.stringify({ verdict: "unchecked", reason }), { headers: h });

  try {
    const sigs = await rpc<{ signature: string; err: unknown }[]>(env, "getSignaturesForAddress", [pool, { limit: 1000, commitment: "confirmed" }]);
    if (sigs.length === 0) return unchecked("The pool's early transactions couldn't be read.");
    if (sigs.length >= 1000) return unchecked("This pool is too busy for its opening transactions to be read.");
    const earliest = sigs.filter((s) => s.err === null).slice(-EARLY_TXS).reverse(); // oldest first
    const txs = await Promise.all(
      earliest.map((s) =>
        rpc<{ transaction: { message: { accountKeys: ({ pubkey: string } | string)[] } } } | null>(env, "getTransaction", [s.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]).catch(() => null),
      ),
    );
    const senders = txs.map((t) => t?.transaction.message.accountKeys[0]).map((k) => (typeof k === "string" ? k : k?.pubkey)).filter((a): a is string => !!a);
    if (senders.length === 0) return unchecked("The pool's early transactions couldn't be read.");
    const creator = senders[0]; // the first transaction on a pool is its creation
    const first: string[] = [];
    for (const s of senders) if (s !== creator && !first.includes(s) && first.length < SNIPERS) first.push(s);
    if (first.length === 0) return unchecked("No one but the creator has traded this pool yet.");

    const sup = await rpc<{ value: { amount: string } }>(env, "getTokenSupply", [coin]);
    const supply = /^\d+$/.test(sup.value.amount) ? BigInt(sup.value.amount) : 0n;
    if (supply <= 0n) return unchecked("Total supply couldn't be read.");

    const held = await Promise.all(
      first.map(async (a) => {
        try {
          const r = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>(env, "getTokenAccountsByOwner", [a, { mint: coin }, { encoding: "jsonParsed" }]);
          return r.value.reduce((s, x) => s + BigInt(x.account.data.parsed.info.tokenAmount.amount), 0n);
        } catch {
          return 0n;
        }
      }),
    );
    const total = held.reduce((s, v) => s + v, 0n);
    const pct = (v: bigint) => Number((v * 100000n) / supply) / 1000;
    return new Response(
      JSON.stringify({
        verdict: "ok",
        wallets: first.length,
        stillHolding: held.filter((v) => v > 0n).length,
        heldPct: pct(total),
        rows: first.map((a, i) => ({ address: a, pct: pct(held[i]) })).sort((a, b) => b.pct - a.pct).slice(0, 5),
      }),
      { headers: h },
    );
  } catch {
    return unchecked("The pool's early transactions couldn't be read.");
  }
}
