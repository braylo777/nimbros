import type { Peg } from "../../lib/pegged.ts";

/* GET  /api/peg → { "<underlying coin type>": { pegSymbol, coinType } }
   POST /api/peg {underlying, ticker, coinType} → registers a launched NMBR coin.

   Reads only for now (see the POST handler). */

interface KV { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> }
interface Env { FEEDS?: KV }
const KEY = "peg:index";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": status === 200 ? "public, s-maxage=30" : "no-store" } });
const read = async (kv?: KV): Promise<Record<string, Peg>> => {
  try { return kv ? (JSON.parse((await kv.get(KEY)) ?? "{}") as Record<string, Peg>) : {}; } catch { return {}; }
};

export async function onRequestGet({ env }: { env: Env }): Promise<Response> {
  return json(await read(env.FEEDS));
}

/* Registering a pegged coin belongs to the Sui launcher, which is gone. It comes back with the Solana launch flow; until then this refuses. */
export async function onRequestPost(): Promise<Response> {
  return json({ error: "not available on Solana yet" }, 501);
}
