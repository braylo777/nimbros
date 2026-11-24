import type { D1 } from "../../lib/accountStore.ts";
import { json } from "../../lib/agentHttp.ts";

/* GET /api/platform → {coins: [mint]}: every coin launched on NimBros or traded here (by an agent or a person).
   The homepage headline numbers are computed over exactly these coins, not over the whole Solana market.
   Read from the launch list and the settled-trade ledger; cached 30 s at the edge. */
interface KV { get(k: string): Promise<string | null> }
interface Env { DB?: D1; FEEDS?: KV }
const WSOL = "So11111111111111111111111111111111111111112";

export async function onRequestGet({ env }: { env: Env }): Promise<Response> {
  const coins = new Set<string>();
  try {
    const launches = JSON.parse((await env.FEEDS?.get("launches:index")) ?? "[]") as { coinType?: string }[];
    for (const l of launches) if (typeof l.coinType === "string") coins.add(l.coinType);
  } catch { /* the launch list is optional */ }
  try {
    if (env.DB) {
      const r = await env.DB.prepare("SELECT detail FROM real_ledger ORDER BY ts DESC LIMIT 1000").all<{ detail: string }>();
      for (const row of r.results) {
        const d = JSON.parse(row.detail) as { coin?: string; changes?: { coin?: string }[] };
        if (typeof d.coin === "string") coins.add(d.coin);
        for (const c of d.changes ?? []) if (typeof c.coin === "string" && c.coin !== WSOL) coins.add(c.coin);
      }
    }
  } catch { /* an unreadable ledger just means fewer coins */ }
  coins.delete(WSOL);
  return json({ coins: [...coins] }, 200, "public, s-maxage=30, stale-while-revalidate=60");
}
