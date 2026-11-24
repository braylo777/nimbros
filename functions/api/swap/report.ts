import { json } from "../../../lib/agentHttp.ts";
import type { D1 } from "../../../lib/accountStore.ts";
import { bump } from "../../../lib/counter.ts";
import { d1Ledger } from "../../../lib/realLedger.ts";
import { marks } from "../../../lib/serverMarket.ts";
import { WSOL_MINT } from "../../../lib/chain.ts";
import { txSummary } from "../../../lib/solTx.ts";
import type { RpcEnv } from "../../../lib/solRpc.ts";

/* POST /api/swap/report {digest} — records a swap a person made on NimBros, so the homepage can show which coins are really traded here.
   Nothing in the request is trusted: the transaction is read from Solana, must have succeeded, and must be a swap of exactly one coin against
   SOL for its signer. Volume is the SOL that moved, priced in dollars. One row per signature, so repeats change nothing. */
interface Env extends RpcEnv { DB?: D1 }

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (!env.DB) return json({ error: "unavailable" }, 503);
  try {
    const digest = ((await request.json()) as { digest?: unknown }).digest;
    if (typeof digest !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(digest)) return json({ error: "digest must be a transaction signature" }, 400);
    const ip = request.headers.get("cf-connecting-ip") ?? "local";
    if ((await bump(env.DB, `swaprep:${ip}`, 60_000)) > 60) return json({ error: "slow down" }, 429);

    const tx = await txSummary(env, digest);
    if (!tx) return json({ error: "transaction not found yet; try again in a few seconds" }, 404);
    if (!tx.ok) return json({ error: "that transaction did not succeed" }, 422);
    if (tx.tokens.length !== 1 || tx.solDelta === 0n) return json({ error: "not a swap of one coin against SOL" }, 422);
    const solPrice = (await marks([WSOL_MINT])).get(WSOL_MINT) ?? 0;
    const usd = (Math.abs(Number(tx.solDelta)) / 1e9) * solPrice;
    const coin = tx.tokens[0].mint;
    const recorded = await d1Ledger(env.DB).add({
      id: `hum${digest.slice(0, 12)}`, ts: tx.ts || Date.now(), agentId: "human", address: tx.signer, kind: "reported", usd, digest,
      detail: { human: true, coin, side: tx.tokens[0].raw > 0n ? "buy" : "sell" },
    });
    return json({ ok: true, recorded });
  } catch {
    return json({ error: "report failed" }, 500);
  }
}
