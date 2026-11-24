import { isSolAddress } from "../../lib/chain.ts";
import { rpc } from "../../lib/solRpc.ts";
import { txSummary } from "../../lib/solTx.ts";
import { json, loadActors, recentSignatures, tokenAccounts, type ShieldEnv } from "../../lib/shieldHttp.ts";

/* GET /api/track?address=<wallet> → what a followed wallet holds and what it just did: SOL, top holdings, and its latest transactions reduced to
   "SOL moved / which token moved". Read-only and public data: following a wallet needs nothing from its owner. `listed` is true when the wallet is on the
   scam watchlist. Anything the node refuses is named in `degraded`. */

export async function onRequestGet({ request, env }: { request: Request; env: ShieldEnv }): Promise<Response> {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!isSolAddress(address)) return json({ error: "address must be a Solana wallet address" }, 400);
  const degraded: string[] = [];
  const [sol, accts, sigs, actors] = await Promise.all([
    rpc<{ value: number }>(env, "getBalance", [address, { commitment: "confirmed" }]).then((r) => r.value / 1e9).catch(() => { degraded.push("SOL balance"); return null; }),
    tokenAccounts(env, address).catch(() => { degraded.push("holdings (needs an RPC node that allows indexed reads)"); return null; }),
    recentSignatures(env, address, 8).catch(() => { degraded.push("recent activity"); return null; }),
    loadActors(env),
  ]);
  const activity = sigs
    ? (await Promise.all(sigs.map(async (s) => {
        try {
          const t = await txSummary(env, s.signature);
          return { signature: s.signature, ts: s.ts, ok: s.ok, solDelta: t ? Number(t.solDelta) / 1e9 : null, tokens: t ? t.tokens.map((x) => ({ mint: x.mint, raw: x.raw.toString() })) : [] };
        } catch {
          return { signature: s.signature, ts: s.ts, ok: s.ok, solDelta: null, tokens: [] };
        }
      })))
    : null;
  const holdings = accts ? accts.filter((a) => BigInt(a.amount) > 0n).map((a) => ({ mint: a.mint, amount: a.amount, decimals: a.decimals, ui: Number(a.amount) / 10 ** a.decimals })).slice(0, 40) : null;
  const actor = actors.find((a) => a.address === address);
  return json({ address, sol, holdings, activity, listed: !!actor, listing: actor ?? null, degraded, ts: Date.now() });
}
