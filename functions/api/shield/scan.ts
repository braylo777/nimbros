import { isSolAddress } from "../../../lib/chain.ts";
import { scanWallet } from "../../../lib/shieldScan.ts";
import { json, type ShieldEnv } from "../../../lib/shieldHttp.ts";

/* GET /api/shield/scan?address=<wallet> → a read-only health check of a wallet: SOL, holdings, who is allowed to spend your tokens,
   how risky each coin is, recent activity, and one overall risk level. No keys, nothing signed, nothing stored.
   Anything the node won't tell us (many free nodes refuse indexed reads) is listed in `degraded`, never guessed. */

export async function onRequestGet({ request, env }: { request: Request; env: ShieldEnv }): Promise<Response> {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!isSolAddress(address)) return json({ error: "address must be a Solana wallet address" }, 400);
  return json(await scanWallet(env, address), 200);
}
