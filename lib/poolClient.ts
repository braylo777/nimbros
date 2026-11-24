import { POOL_ADDR, RANGE_SPEC, normalizeCandles, normalizeTrades, type Candle, type PoolTrade, type RangeId } from "./pool.ts";

/* Browser-side loader for a pool's candles and trades.

   1. Our own /api/pool — cached at the edge, so many viewers cost one upstream call.
   2. If that is unavailable (GeckoTerminal rate-limits shared server IPs, so this does
      happen), the browser asks GeckoTerminal directly. It allows cross-origin reads, and
      the request then counts against the visitor's own IP instead of a shared one.

   Everything passes through the same normalisers, so a malformed reply from either
   path is dropped rather than drawn. */

export interface PoolData { candles: Candle[]; trades: PoolTrade[]; via: "server" | "direct" }

const GT = "https://api.geckoterminal.com/api/v2/networks/solana/pools";

/* Last good chart per coin and interval, kept in this browser so a token page never opens to an empty
   box: GeckoTerminal's free tier sometimes refuses, and an older chart beats nothing. Read/write is
   shared between the token page (which renders it) and the prefetcher below (which warms it early). */
const CHART_TTL_MS = 6 * 3600_000;
const cacheKey = (pool: string, range: string) => `nb_chart_${pool}_${range}`;
export function readChartCache(pool: string, range: string): { candles: Candle[]; trades: PoolTrade[]; savedAt: number } | null {
  try {
    const j = JSON.parse(localStorage.getItem(cacheKey(pool, range)) ?? "null") as { candles?: Candle[]; trades?: PoolTrade[]; t?: number } | null;
    if (!j || !Array.isArray(j.candles) || !Array.isArray(j.trades) || typeof j.t !== "number" || Date.now() - j.t > CHART_TTL_MS || j.candles.length < 2) return null;
    return { candles: j.candles, trades: j.trades, savedAt: j.t };
  } catch { return null; }
}
export function writeChartCache(pool: string, range: string, candles: Candle[], trades: PoolTrade[]) {
  try { localStorage.setItem(cacheKey(pool, range), JSON.stringify({ candles: candles.slice(-200), trades: trades.slice(0, 20), t: Date.now() })); } catch { /* quota or blocked */ }
}

/* Warms the chart cache for a coin before the user clicks into it (called on row hover/touch). Best-effort,
   silent, and deduped so hovering the same row repeatedly doesn't refire the request. Skips anything
   already fresh enough that a refetch wouldn't change what's shown. */
const PREFETCH_FRESH_MS = 45_000;
const inFlight = new Set<string>();
export function prefetchPool(pool: string, range: RangeId): void {
  if (typeof window === "undefined" || !POOL_ADDR.test(pool)) return;
  const k = `${pool}|${range}`;
  if (inFlight.has(k)) return;
  const cached = readChartCache(pool, range);
  if (cached && Date.now() - cached.savedAt < PREFETCH_FRESH_MS) return;
  inFlight.add(k);
  loadPoolData(pool, range)
    .then((d) => writeChartCache(pool, range, d.candles, d.trades))
    .catch(() => { /* best-effort: the token page will retry with its own error handling */ })
    .finally(() => inFlight.delete(k));
}

export async function loadPoolData(pool: string, range: RangeId, f: typeof fetch = fetch): Promise<PoolData> {
  if (!POOL_ADDR.test(pool) || !(range in RANGE_SPEC)) throw new Error("bad pool or range");

  try {
    // Bounded so a slow edge/upstream can't stall the page: fail over to the direct
    // path quickly instead of leaving the chart hanging on one slow request.
    const r = await f(`/api/pool?p=${pool}&r=${range}`, { cache: "no-store", signal: AbortSignal.timeout(3500) });
    if (r.ok) {
      const j = (await r.json()) as { candles?: Candle[]; trades?: PoolTrade[] };
      if (Array.isArray(j.candles) && Array.isArray(j.trades) && (j.candles.length > 0 || j.trades.length > 0)) {
        return { candles: j.candles, trades: j.trades, via: "server" };
      }
    }
  } catch {
    /* fall through to the direct path */
  }

  const s = RANGE_SPEC[range];
  const [c, t] = await Promise.allSettled([
    f(`${GT}/${pool}/ohlcv/${s.frame}?aggregate=${s.aggregate}&limit=${s.limit}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    f(`${GT}/${pool}/trades`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
  ]);
  const candles = c.status === "fulfilled" ? normalizeCandles(c.value) : [];
  const trades = t.status === "fulfilled" ? normalizeTrades(t.value) : [];
  if (candles.length === 0 && trades.length === 0) throw new Error("unavailable");
  return { candles, trades, via: "direct" };
}
