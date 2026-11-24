import { withOnChainLogos } from "../../lib/feeds.ts";
import { enrich, fallbackRows, parsePairs, type DsPair } from "../../lib/dexscreener.ts";
import { GT_SOURCE_URLS, buildFeeds, splitTokens } from "../../lib/lifecycle.ts";
import type { Token } from "../../lib/types.ts";
import type { D1 } from "../../lib/accountStore.ts";
import { d1Kv } from "../../lib/d1kv.ts";

/* GET /api/feed?k=snipe|scalp — the live lists, assembled server-side so the
   browser never talks to a third-party API (CSP connect-src stays 'self') and
   N viewers cost one upstream call per cache window.

   snipe = fresh coins up to graduation, scalp = graduated coins with real liquidity (lib/lifecycle.ts).
   Both lists are cut from the same pool of tokens, so a coin is in exactly one of them.

   Two sources, with distinct jobs:
     GeckoTerminal — discovery (new, trending and busiest pools), the canonical prices.
     DexScreener   — pool RESERVES (what makes an honest fill model possible),
                     gap-filling, and discovery of last resort when GT is down.

   Degradation, in order: live -> edge cache -> KV (up to 6h, flagged `stale`)
   -> 503. An empty column is never filled with invented rows. */

const DS = "https://api.dexscreener.com/latest/dex";
/* DexScreener has no "new pools" endpoint; searching the big Solana venues is the
   closest keyless equivalent and is only used when GeckoTerminal is unavailable. */
const DS_FALLBACK_QUERIES = ["pump.fun", "pumpswap", "raydium", "meteora", "bonk.fun"];

const KV_WRITE_EVERY_MS = 4 * 60_000; // free KV allows 1,000 writes/day
const KV_TTL_S = 6 * 3600; // a fallback older than this is worse than an honest error

interface KV { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> }
interface Env { FEEDS?: KV; DB?: D1 }
type Kind = "snipe" | "scalp";

const json = (body: unknown, status: number, cache: string) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": cache } });

const get = async (url: string, ttl: number) => {
  const r = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
    cf: { cacheTtl: ttl, cacheEverything: true },
  } as RequestInit);
  if (!r.ok) throw new Error(`upstream ${r.status}`);
  return r.json();
};

/** Reserves for rows we already have — 30 pools per call is DexScreener's batch limit. */
async function detailFor(rows: Token[]): Promise<DsPair[]> {
  const addrs = rows.map((t) => t.id.replace(/^gt:/, "")).filter((a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)).slice(0, 30);
  if (addrs.length === 0) return [];
  try {
    return parsePairs(await get(`${DS}/pairs/solana/${addrs.join(",")}`, 45));
  } catch {
    return []; // enrichment is a bonus; never fail the feed over it
  }
}

async function discoverViaDexScreener(k: Kind): Promise<Token[]> {
  const results = await Promise.allSettled(DS_FALLBACK_QUERIES.map((q) => get(`${DS}/search?q=${encodeURIComponent(q)}`, 60)));
  const pairs = results.flatMap((r) => (r.status === "fulfilled" ? parsePairs(r.value) : []));
  return splitTokens(fallbackRows(pairs, "agent", () => true))[k];
}

/* Both lists are cut from the same pages, so fetch them once and share the result: the snipe and scalp requests
   arrive together, and fetching twice would double our use of GeckoTerminal's free tier. */
let shared: { at: number; p: Promise<unknown[]> } | null = null;
const SHARE_MS = 20_000;

/** Every GeckoTerminal source page at once; pages that fail are skipped, so one slow page never blanks the lists. */
function discoverViaGecko(): Promise<unknown[]> {
  if (shared && Date.now() - shared.at < SHARE_MS) return shared.p;
  const p = Promise.allSettled(GT_SOURCE_URLS.map((u) => get(u, 45))).then((rs) => rs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])));
  shared = { at: Date.now(), p };
  // an empty result must not be remembered: the next request should try again
  void p.then((pages) => { if (pages.length === 0 && shared?.p === p) shared = null; });
  return p;
}

export async function onRequestGet({ request, env: rawEnv }: { request: Request; env: Env }): Promise<Response> {
  // the list cache lives in D1 (rewritten every 30 s by the cron, far past KV's free write limit); KV is only the fallback if D1 is missing
  const env: { FEEDS?: KV } = { FEEDS: rawEnv.DB ? d1Kv(rawEnv.DB) : rawEnv.FEEDS };
  const k = new URL(request.url).searchParams.get("k") as Kind | null;
  if (k !== "snipe" && k !== "scalp") return new Response("bad request", { status: 400 });

  /* Fast path: the scheduled job (api/cron/feeds) keeps finished lists in KV, so most requests are one small read.
     Anything older than 10 minutes means the job is behind, so fall through to the live path below. */
  if (env.FEEDS) {
    try {
      const kv = JSON.parse((await env.FEEDS.get(`feed:${k}`)) ?? "null") as { ts?: number; rows?: unknown[] } | null;
      if (kv?.ts && Array.isArray(kv.rows) && kv.rows.length > 0 && Date.now() - kv.ts < 10 * 60_000) return json(kv, 200, "public, s-maxage=15, stale-while-revalidate=60");
    } catch { /* live path */ }
  }

  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const lastGoodKey = new Request(`https://feed.internal/last-good/${k}`);

  try {
    let rows: Token[] = [];
    let sources: string[] = [];
    try {
      const pages = await discoverViaGecko();
      rows = pages.length > 0 ? buildFeeds(pages)[k] : [];
      sources = ["geckoterminal"];
    } catch {
      rows = [];
    }
    if (rows.length === 0) {
      // A recent list of the RIGHT kind of pool beats a fresh list of the wrong kind: use the last good copy
      // before the backup source, which cannot see new pools at all.
      const old = cache ? await cache.match(lastGoodKey) : undefined;
      if (old) return json({ ...((await old.json()) as Record<string, unknown>), stale: true }, 200, "public, s-maxage=10");
      if (env.FEEDS) {
        try {
          const kv = await env.FEEDS.get(`feed:${k}`);
          if (kv) return json({ ...(JSON.parse(kv) as Record<string, unknown>), stale: true }, 200, "public, s-maxage=10");
        } catch {
          /* fall through to the backup source */
        }
      }
      rows = await discoverViaDexScreener(k);
      sources = ["dexscreener"];
    } else {
      const detail = await detailFor(rows);
      if (detail.length > 0) {
        rows = enrich(rows, detail);
        sources.push("dexscreener");
      }
    }
    if (rows.length === 0) throw new Error("no usable rows");

    rows = await withOnChainLogos(rows);
    /* the backup source has no new-pool endpoint, so a snipe list built from it
       can only contain pools that were already established */
    const body = { rows, ts: Date.now(), sources, degraded: sources[0] === "dexscreener" };

    if (cache) await cache.put(lastGoodKey, json(body, 200, "public, max-age=900"));
    if (env.FEEDS) {
      try {
        const prev = JSON.parse((await env.FEEDS.get(`feed:${k}`)) ?? "null") as { ts?: number } | null;
        if (!prev?.ts || Date.now() - prev.ts > KV_WRITE_EVERY_MS) {
          await env.FEEDS.put(`feed:${k}`, JSON.stringify(body), { expirationTtl: KV_TTL_S });
        }
      } catch {
        /* the fallback store is best-effort */
      }
    }
    return json(body, 200, "public, s-maxage=45, stale-while-revalidate=30");
  } catch (e) {
    const good = cache ? await cache.match(lastGoodKey) : undefined;
    if (good) return json({ ...((await good.json()) as Record<string, unknown>), stale: true }, 200, "public, s-maxage=20");
    if (env.FEEDS) {
      try {
        const kv = await env.FEEDS.get(`feed:${k}`);
        if (kv) return json({ ...(JSON.parse(kv) as Record<string, unknown>), stale: true }, 200, "public, s-maxage=20");
      } catch {
        /* fall through */
      }
    }
    return json({ error: "feed unavailable", reason: e instanceof Error ? e.message : "unknown" }, 503, "no-store");
  }
}
