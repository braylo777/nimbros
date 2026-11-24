import { enrich, fallbackRows, parsePairs } from "../../../lib/dexscreener.ts";
import { normalizePools, withOnChainLogos } from "../../../lib/feeds.ts";
import { splitTokens } from "../../../lib/lifecycle.ts";
import { allDexes, dsQueriesFor, mergePools, needsReserves, pickSources, type CachedPool } from "../../../lib/poolCache.ts";
import { json, type Env } from "../../../lib/agentHttp.ts";
import { d1Kv } from "../../../lib/d1kv.ts";

/* POST /api/cron/feeds — rebuild the token lists from every Solana exchange and launchpad and store them ready to serve.
   Called by the scheduled worker (a couple of times a minute) with the shared secret. Each run reads the hottest
   pages plus the next few of the rest, merges them into the cache, adds pool reserves and logos where missing,
   and writes the finished Snipe and Scalp lists, so /api/feed is a single fast read. */

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const DS = "https://api.dexscreener.com/latest/dex";
const SLOT_MS = 30_000;
const POOLS_KEY = "pools:v1";
const DEX_KEY = "dexes:list";

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
};
const get = async (url: string) => {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.json();
};

/** Every exchange GeckoTerminal indexes on Solana, re-read every six hours so new exchanges appear on their own. */
async function exchanges(kv: { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> }): Promise<string[]> {
  try {
    const cached = JSON.parse((await kv.get(DEX_KEY)) ?? "null") as { ts: number; ids: string[] } | null;
    if (cached && Date.now() - cached.ts < 6 * 3600_000 && cached.ids.length > 0) return cached.ids;
  } catch { /* re-read below */ }
  try {
    const ids: string[] = [];
    for (const page of [1, 2]) {
      const j = (await get(`${GT}/dexes?page=${page}`)) as { data?: { id?: string }[] };
      for (const d of j.data ?? []) if (typeof d.id === "string" && /^[a-z0-9-]{2,40}$/.test(d.id)) ids.push(d.id);
    }
    if (ids.length > 0) { await kv.put(DEX_KEY, JSON.stringify({ ts: Date.now(), ids }), { expirationTtl: 86_400 }); return ids; }
  } catch { /* fall through */ }
  return [];
}

export async function onRequestPost({ request, env }: { request: Request; env: Env & { CRON_SECRET?: string } }): Promise<Response> {
  const secret = env.CRON_SECRET ?? "";
  if (secret.length < 24 || !same(secret, request.headers.get("x-cron-secret") ?? "")) return json({ error: "forbidden" }, 403);
  const kv = env.DB ? d1Kv(env.DB) : env.FEEDS;
  if (!kv) return json({ error: "unavailable" }, 503);
  const t0 = Date.now();
  try {
    const dexIds = allDexes(await exchanges(kv));
    const slot = Math.floor(t0 / SLOT_MS);
    const urls = pickSources(dexIds, slot);
    const results = await Promise.allSettled(urls.map(get));
    const pages = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failures = results.flatMap((r) => (r.status === "rejected" ? [String((r.reason as Error)?.message ?? r.reason)] : []));
    if (failures.length > 0) console.log(`feeds: ${pages.length}/${urls.length} pages answered; failures: ${[...new Set(failures)].join(", ")}`);

    // DexScreener finds exchanges GeckoTerminal doesn't index, and it isn't refused the way GeckoTerminal is from this address
    const dsResults = await Promise.allSettled(dsQueriesFor(slot).map((q) => get(`${DS}/search?q=${encodeURIComponent(q)}`)));
    const dsRows = fallbackRows(dsResults.flatMap((r) => (r.status === "fulfilled" ? parsePairs(r.value) : [])), "agent", () => true);

    let prev: CachedPool[] = [];
    try { prev = (JSON.parse((await kv.get(POOLS_KEY)) ?? "null") as { rows?: CachedPool[] } | null)?.rows ?? []; } catch { /* start fresh */ }
    // never replace good data with nothing: if no source answered, keep what is stored and try again next run
    if (pages.length === 0 && dsRows.length === 0) return json({ ok: false, reason: "no upstream answered; kept the last cache", failures: [...new Set(failures)], pools: prev.length }, 200);

    let rows = mergePools(prev, [...normalizePools(pages, "agent"), ...dsRows], t0);

    // pool reserves (what makes the exit-cost estimate honest) and logos, for the busiest rows still missing them
    const want = needsReserves(rows, 60);
    if (want.length > 0) {
      const detail = [];
      for (let i = 0; i < want.length; i += 30) {
        const addrs = want.slice(i, i + 30).map((r) => r.id.replace(/^gt:/, "")).filter((a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a));
        if (addrs.length === 0) continue;
        try { detail.push(...parsePairs(await get(`${DS}/pairs/solana/${addrs.join(",")}`))); } catch { /* enrichment is a bonus */ }
      }
      if (detail.length > 0) {
        const enriched = new Map(enrich(want, detail).map((r) => [r.id, r]));
        rows = rows.map((r) => (enriched.has(r.id) ? { ...r, ...enriched.get(r.id)!, seen: r.seen } : r));
      }
    }
    const logoed = await withOnChainLogos(rows.filter((r) => !r.logo).slice(0, 40));
    const logoById = new Map(logoed.filter((r) => r.logo).map((r) => [r.id, r.logo]));
    if (logoById.size > 0) rows = rows.map((r) => (r.logo ? r : { ...r, logo: logoById.get(r.id) }));

    const ts = Date.now();
    const sources = ["geckoterminal", ...(dsRows.length > 0 || want.length > 0 ? ["dexscreener"] : [])];
    const lists = splitTokens(rows); // the same rule the browser uses
    const strip = (t: (typeof rows)[number]) => { const { seen: _seen, ...rest } = t; void _seen; return rest; };
    await kv.put(POOLS_KEY, JSON.stringify({ ts, rows }), { expirationTtl: 3600 });
    for (const k of ["snipe", "scalp"] as const) {
      if (lists[k].length === 0) continue;
      await kv.put(`feed:${k}`, JSON.stringify({ rows: lists[k].map((t) => strip(t as never)), ts, sources, degraded: false }), { expirationTtl: 6 * 3600 });
    }
    return json({ ok: true, ms: Date.now() - t0, requests: urls.length + 1, answered: pages.length, failures: [...new Set(failures)], pools: rows.length, snipe: lists.snipe.length, scalp: lists.scalp.length, exchanges: dexIds.length });
  } catch (e) {
    console.error("feed refresh failed", (e as Error)?.message);
    return json({ error: "refresh failed" }, 500);
  }
}
