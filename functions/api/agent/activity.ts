import { json, type Env } from "../../../lib/agentHttp.ts";
import { d1Ledger } from "../../../lib/realLedger.ts";

/* GET /api/agent/activity — the latest settled agent trades, platform-wide: when, buy or sell, and the on-chain signature. No wallets, no amounts.
   Everything here is public on chain already; this only lists it so anyone can click through and check. */
export async function onRequestGet({ env }: { env: Env }): Promise<Response> {
  if (!env.DB) return json({ trades: [] }, 200, "no-store");
  try {
    const rows = await d1Ledger(env.DB).recent(15);
    return json({ trades: rows.map((r) => ({ ts: r.ts, side: r.side === "sell" ? "sell" : "buy", sig: r.digest ?? null })) }, 200, "public, s-maxage=20");
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
