import type { Token } from "../../lib/types.ts";

/* GET /api/coins — every coin currently tracked (snipe + scalp), reduced to just what a third-party
   integration needs to match a ticker to a tradeable contract: no price, no liquidity, nothing that
   goes stale in seconds. Meant for the browser extension (and anything else outside the app) that
   wants to know "is this coin on NimBros, and what's its address" without pulling the full feed shape.

   Reads the same KV the live feed writes to (see functions/api/feed.ts and api/cron/feeds.ts), so this
   costs nothing extra upstream — it's a reshape of data already being fetched for the homepage. */

interface KV { get(k: string): Promise<string | null> }
interface Env { FEEDS?: KV }

export interface CoinEntry { ticker: string; contract: string; id: string; name: string; dex?: string }

const json = (body: unknown, status: number, cache: string) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": cache, "access-control-allow-origin": "*" } });

function toEntry(t: Token): CoinEntry {
  return { ticker: t.ticker, contract: t.contract, id: t.id, name: t.name, dex: t.dex };
}

async function fromKv(env: Env, k: "snipe" | "scalp"): Promise<Token[]> {
  if (!env.FEEDS) return [];
  try {
    const j = JSON.parse((await env.FEEDS.get(`feed:${k}`)) ?? "null") as { rows?: Token[] } | null;
    return Array.isArray(j?.rows) ? j.rows : [];
  } catch {
    return [];
  }
}

export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const [snipe, scalp] = await Promise.all([fromKv(env, "snipe"), fromKv(env, "scalp")]);
  const rows = [...snipe, ...scalp];

  if (rows.length === 0) {
    // KV hasn't been primed yet (cold start) — fall back to the live feed once, same-origin.
    try {
      const origin = new URL(request.url).origin;
      const [a, b] = await Promise.all([
        fetch(`${origin}/api/feed?k=snipe`).then((r) => (r.ok ? r.json() : { rows: [] })),
        fetch(`${origin}/api/feed?k=scalp`).then((r) => (r.ok ? r.json() : { rows: [] })),
      ]);
      rows.push(...((a as { rows?: Token[] }).rows ?? []), ...((b as { rows?: Token[] }).rows ?? []));
    } catch {
      /* nothing to fall back to */
    }
  }
  if (rows.length === 0) return json({ coins: [], ts: Date.now() }, 200, "public, s-maxage=15");

  const seen = new Set<string>();
  const coins: CoinEntry[] = [];
  for (const t of rows) {
    if (!t.contract || seen.has(t.contract)) continue;
    seen.add(t.contract);
    coins.push(toEntry(t));
  }
  return json({ coins, ts: Date.now() }, 200, "public, s-maxage=30, stale-while-revalidate=60");
}
