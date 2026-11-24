import { json } from "../../lib/agentHttp.ts";
import { realConfig, realDeps, type RealEnv } from "../../lib/realHttp.ts";
import { isSolAddress, WSOL_MINT } from "../../lib/chain.ts";
import { rpc } from "../../lib/solRpc.ts";
import { topHolders } from "../../lib/solHolders.ts";
import { classifySell } from "../../lib/sellcheck.ts";

/* GET /api/sellcheck?coin=<mint> → does selling this coin actually work, and does anything skim the sale?
   We take a real holder of the coin, ask Jupiter to sell a slice of THEIR coins for SOL, and have Solana
   dry-run that transaction as them (no signature needed, nothing is sent). A sale that fails for a wallet that holds
   the coin (and has SOL for fees) means sells are blocked; a sale that pays out far less than the quote means a tax or
   skim. If no holder can be tested we say "unchecked", never "fine". */

const h = { "cache-control": "public, s-maxage=300, stale-while-revalidate=900" };

async function solBalance(env: RealEnv, a: string): Promise<bigint | undefined> {
  try {
    return BigInt((await rpc<{ value: number }>(env, "getBalance", [a, { commitment: "confirmed" }])).value);
  } catch {
    return undefined;
  }
}

export async function onRequestGet({ request, env }: { request: Request; env: RealEnv }): Promise<Response> {
  const coin = new URL(request.url).searchParams.get("coin") ?? "";
  if (!isSolAddress(coin)) return json({ error: "bad coin" }, 400);
  const out = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json", ...h } });
  try {
    const d = realDeps(env, await realConfig(env));
    if (!d) return out({ verdict: "unchecked", reason: "The checker is unavailable." });
    const list = (await topHolders(env, coin, 20)).slice(0, 5);
    if (list.length === 0) return out({ verdict: "unchecked", reason: "No wallet holds this coin directly, so there is nobody to test a sale as." });

    let last = "Couldn't build a test sale.";
    for (const hd of list) {
      for (const div of [20n, 2n]) {
        const amount = hd.raw / div;
        if (amount <= 0n) continue;
        const q = await d.quote(coin, WSOL_MINT, amount, 0.05).catch(() => null);
        if (!q || q.insufficient || q.amountOut <= 0n) { last = "No route to sell into."; continue; }
        if (q.amountOut < 30_000_000n) { last = "Holders' balances are too small to test a sale."; continue; }
        const holderSolRaw = await solBalance(env, hd.address);
        if (holderSolRaw !== undefined && holderSolRaw < 20_000_000n) { last = "The tested holder has too little SOL for fees."; continue; }
        let built;
        try {
          built = await d.buildAndSimulate(q.router, hd.address, 0.05);
        } catch (e) {
          last = String((e as Error)?.message ?? "build failed").slice(0, 120);
          continue;
        }
        const v = classifySell({ success: built.success, changes: built.changes, address: hd.address, expectedOutRaw: q.amountOut, coin, feeBps: d.cfg.feeBps, holderSuiRaw: holderSolRaw });
        if (v.verdict === "inconclusive") { last = v.reason; continue; }
        return out(v);
      }
    }
    return out({ verdict: "unchecked", reason: last });
  } catch {
    return out({ verdict: "unchecked", reason: "The check failed. Treat as unverified." });
  }
}
