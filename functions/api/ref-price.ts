import { WSOL_MINT } from "../../lib/chain.ts";
import { marks } from "../../lib/serverMarket.ts";

/* GET /api/ref-price → {median, ts}: SOL's dollar price, read server-side from the deepest live SOL pool.
   Used only to express what you hold in dollars — never to price a trade (every trade is quoted and simulated separately). */
export async function onRequestGet(): Promise<Response> {
  const h = { "content-type": "application/json", "cache-control": "public, s-maxage=20, stale-while-revalidate=60" };
  const v = (await marks([WSOL_MINT])).get(WSOL_MINT);
  if (!(typeof v === "number" && v > 0)) return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { ...h, "cache-control": "no-store" } });
  return new Response(JSON.stringify({ median: v, ts: Date.now() }), { headers: h });
}
