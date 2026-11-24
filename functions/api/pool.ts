import { POOL_ADDR, RANGE_SPEC, normalizeCandles, normalizeTrades, type RangeId } from "../../lib/pool.ts";

/* GET /api/pool?p=<pool address>&r=1m|5m|15m|1H|4H|1D — real candles + recent trades
   for one Solana pool (GeckoTerminal), edge-cached for 15 s so N viewers cost one upstream
   call. The address is validated strictly before it goes into an upstream URL.

   When the upstream rate-limits us we serve the last good copy for that pool and
   interval (kept 15 min in the edge cache, flagged `stale`); with none -> 503. */

const GT = "https://api.geckoterminal.com/api/v2/networks/solana/pools";
const get = async (u: string) => {
  const r = await fetch(u, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
    cf: { cacheTtl: 15, cacheEverything: true },
  } as RequestInit);
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.json();
};

const reply = (body: unknown, status: number, cache: string) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": cache } });

export async function onRequestGet({ request }: { request: Request }): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const p = q.get("p") ?? "";
  const r = (q.get("r") ?? "15m") as RangeId;
  if (!POOL_ADDR.test(p) || !(r in RANGE_SPEC)) return new Response("bad request", { status: 400 });
  const s = RANGE_SPEC[r];

  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const lastGood = new Request(`https://pool.internal/last-good/${p}/${r}`);

  const [c, t] = await Promise.allSettled([
    get(`${GT}/${p}/ohlcv/${s.frame}?aggregate=${s.aggregate}&limit=${s.limit}`),
    get(`${GT}/${p}/trades`),
  ]);
  const candles = c.status === "fulfilled" ? normalizeCandles(c.value) : [];
  const trades = t.status === "fulfilled" ? normalizeTrades(t.value) : [];

  if (candles.length > 0 || trades.length > 0) {
    const body = { candles, trades, ts: Date.now() };
    if (cache) await cache.put(lastGood, reply(body, 200, "public, max-age=900"));
    return reply(body, 200, "public, s-maxage=15, stale-while-revalidate=15");
  }
  const good = cache ? await cache.match(lastGood) : undefined;
  if (good) return reply({ ...((await good.json()) as Record<string, unknown>), stale: true }, 200, "public, s-maxage=10");
  const why = (x: PromiseSettledResult<unknown>) => (x.status === "rejected" ? String((x.reason as Error)?.message ?? x.reason).slice(0, 60) : "empty");
  return reply({ error: "unavailable", reason: { candles: why(c), trades: why(t) } }, 503, "no-store");
}
