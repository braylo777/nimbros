import { authenticate } from "../../../lib/agentApi.ts";
import { depsFrom, json } from "../../../lib/agentHttp.ts";
import { d1Ledger } from "../../../lib/realLedger.ts";
import type { RealEnv } from "../../../lib/realHttp.ts";
import { WSOL_MINT } from "../../../lib/chain.ts";
import { txSummary } from "../../../lib/solTx.ts";

/* POST /api/trade/report {digest} — record a real trade after it executes. The result is read from the
   chain, never taken from the request: sender, success and the net coin changes. Only the agent's own
   linked wallet can be reported. GET /api/trade/report returns the agent's recorded real trades. */

export async function onRequestPost({ request, env }: { request: Request; env: RealEnv }): Promise<Response> {
  const a = depsFrom(env);
  if (!a || !env.DB) return json({ error: "unavailable" }, 503);
  const agent = await authenticate(a, request.headers.get("authorization"));
  if ("ok" in agent) return json({ error: agent.error }, agent.status);
  try {
    const digest = ((await request.json()) as { digest?: unknown }).digest;
    if (typeof digest !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(digest)) return json({ error: "digest must be a transaction signature" }, 400);
    if (!agent.wallet) return json({ error: "link your wallet first" }, 403);
    const tx = await txSummary(env, digest);
    if (!tx) return json({ error: "transaction not found yet; try again in a few seconds" }, 404);
    if (tx.signer !== agent.wallet) return json({ error: "that transaction was not sent by your linked wallet" }, 403);
    const changes = [{ coin: WSOL_MINT, amount: tx.solDelta.toString() }, ...tx.tokens.map((t) => ({ coin: t.mint, amount: t.raw.toString() }))];
    const ok = await d1Ledger(env.DB).add({
      id: `rep${digest.slice(0, 12)}`, ts: tx.ts || Date.now(), agentId: agent.id, address: agent.wallet, kind: "reported", usd: 0, digest,
      detail: { status: tx.ok ? "SUCCESS" : "FAILURE", changes },
    });
    return json({ ok: true, recorded: ok, status: tx.ok ? "SUCCESS" : "FAILURE", changes });
  } catch {
    return json({ error: "report failed" }, 500);
  }
}

export async function onRequestGet({ request, env }: { request: Request; env: RealEnv }): Promise<Response> {
  const a = depsFrom(env);
  if (!a || !env.DB) return json({ error: "unavailable" }, 503);
  const agent = await authenticate(a, request.headers.get("authorization"));
  if ("ok" in agent) return json({ error: agent.error }, agent.status);
  if (!agent.wallet) return json({ wallet: null, trades: [] });
  return json({ wallet: agent.wallet, trades: await d1Ledger(env.DB).history(agent.wallet, 50) });
}
