import { isSolAddress } from "../../lib/chain.ts";
import { getMintInfo, type RpcEnv } from "../../lib/solRpc.ts";
import { topHolders } from "../../lib/solHolders.ts";
import { tokenFacts } from "../../lib/tokenIndex.ts";

/* GET /api/holders?coin=<mint> → who holds a coin, read from Solana itself.
   The holder COUNT and top-10 share come from Jupiter's token index (GeckoTerminal's as a second opinion; RPC can't count holders cheaply); the biggest accounts, their share
   of supply and the supply itself come straight from the node. Pool vaults and other program-owned accounts are listed like
   any holder (RPC can't tell them apart), so a big first row is often the pool. Anything we couldn't read is null, never guessed. */

const TOP = 10;
const h = { "content-type": "application/json", "cache-control": "public, s-maxage=300, stale-while-revalidate=900" };

async function indexHolders(coin: string): Promise<{ count: number | null; top10: number | null }> {
  const f = await tokenFacts(coin);
  return { count: f?.holders ?? null, top10: f?.top10Pct ?? null };
}

export async function onRequestGet({ request, env }: { request: Request; env: RpcEnv }): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  const coin = sp.get("coin") ?? "";
  const light = sp.get("light") === "1"; // list cards only need the count: skip the chain reads
  if (!isSolAddress(coin)) return new Response(JSON.stringify({ error: "bad coin" }), { status: 400, headers: h });

  const gt = await indexHolders(coin);
  if (light) {
    if (gt.count === null) return new Response(JSON.stringify({ error: "lookup failed" }), { status: 503, headers: h });
    return new Response(JSON.stringify({ holders: gt.count, partial: false }), { headers: h });
  }

  /* decimals and supply come from the mint (an RPC read, or the token index when no node is configured); the biggest wallets need a node
     that allows indexed reads, so without one the rows are simply empty, never guessed */
  const info = await getMintInfo(env, coin).catch(() => null);
  const supply = info && /^\d+$/.test(info.supply) && info.supply !== "0" ? BigInt(info.supply) : null;
  let top: { address: string; raw: bigint }[] = [];
  try {
    top = await topHolders(env, coin, 20);
  } catch {
    /* rows stay empty */
  }
  if (gt.count === null && !info) return new Response(JSON.stringify({ error: "lookup failed" }), { status: 503, headers: h });
  const rows = top.slice(0, TOP);
  const heldTotal = top.reduce((s, x) => s + x.raw, 0n);
  const denom = supply ?? heldTotal;
  const pct = (v: bigint) => (denom > 0n ? Number((v * 100000n) / denom) / 1000 : 0);
  const out = rows.map((x) => ({ address: x.address, raw: x.raw.toString(), pct: pct(x.raw), funder: null, linked: null }));
  const haveRows = top.length > 0;
  return new Response(
    JSON.stringify({
      holders: gt.count ?? 0,
      partial: gt.count === null || !haveRows,
      decimals: info?.decimals ?? null,
      supply: supply?.toString() ?? null,
      heldPct: haveRows && supply && supply > 0n ? pct(heldTotal) : null,
      top10Pct: gt.top10 ?? out.reduce((s, r) => s + r.pct, 0),
      rows: out,
      linkedGroups: [],
    }),
    { headers: haveRows ? h : { ...h, "cache-control": "public, s-maxage=120" } },
  );
}
