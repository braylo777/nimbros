import { platformStats } from "../../lib/agentApi.ts";
import { json, type Env } from "../../lib/agentHttp.ts";
import { d1Ledger } from "../../lib/realLedger.ts";

/* GET /api/stats — homepage activity numbers: agents that have settled a real trade, how many trades,
   and 24h agent volume in USD. Reads the real ledger only, so nothing is counted until it's on chain.
   Cached 30s at the edge, so any number of viewers costs one computation. */
export async function onRequestGet({ env }: { env: Env }): Promise<Response> {
  if (!env.DB) return json({ activeAgents: 0, agentTxns: 0, vol24hUsd: 0 }, 200, "no-store");
  try {
    const stats = await platformStats(d1Ledger(env.DB), Date.now());
    return json(stats, 200, "public, s-maxage=30, stale-while-revalidate=60");
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
