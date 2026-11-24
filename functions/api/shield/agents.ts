import { isSolAddress } from "../../../lib/chain.ts";
import { json, type Env } from "../../../lib/agentHttp.ts";
import { d1Ledger } from "../../../lib/realLedger.ts";

/* GET /api/shield/agents?address= — is an agent trading for this wallet? Counts and times of SETTLED agent trades only (the trades are on chain anyway);
   no amounts, no agent ids. Drives the "Agents trading" state of the wallet's status light. */
export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const address = new URL(request.url).searchParams.get("address");
  if (!isSolAddress(address)) return json({ error: "address must be a Solana wallet address" }, 400);
  if (!env.DB) return json({ trades24h: 0, lastAt: null }, 200, "no-store");
  try {
    const rows = await d1Ledger(env.DB).history(address, 100);
    const since = Date.now() - 86_400_000;
    const done = rows.filter((r) => r.kind === "reported" && r.agentId !== "human" && r.ts >= since);
    return json({ trades24h: done.length, lastAt: done.length ? Math.max(...done.map((r) => r.ts)) : null }, 200, "public, s-maxage=20");
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
