import { normalizePools, withOnChainLogos } from "./feeds.ts";
import { splitTokens } from "./lifecycle.ts";
import { KNOWN_DEXES, mergePools, needsReserves, pickSources, type CachedPool } from "./poolCache.ts";
import { enrich, parsePairs } from "./dexscreener.ts";
import type { Token } from "./types.ts";

/* Browser-side loader for the Snipe / Scalp lists.

   1. Our own /api/feed: edge-cached, so most visits are one fast request.
   2. If it is missing, empty, stale or built from the backup source, the browser asks
      GeckoTerminal and DexScreener directly (both allow cross-origin reads). That
      request counts against the visitor's own IP, not the shared server IPs that get
      rate-limited, so the lists fill in even when the server can't.

   Either way the same normalisers run, so a malformed reply is dropped, never drawn. */

export type Kind = "snipe" | "scalp";
export interface FeedResult { rows: Token[]; ts: number; sources: string[]; stale: boolean }

const DS = "https://api.dexscreener.com/latest/dex";

const json = async (f: typeof fetch, url: string) => {
  const r = await f(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
};

async function viaServer(kind: Kind, f: typeof fetch): Promise<(FeedResult & { degraded: boolean }) | null> {
  try {
    // no cache override: the page preloads this exact request (see app/layout.tsx), and a fresh request would waste that head start
    const r = await f(`/api/feed?k=${kind}`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { rows?: Token[]; ts?: number; sources?: string[]; stale?: boolean; degraded?: boolean };
    if (!Array.isArray(j.rows) || j.rows.length === 0) return null;
    return { rows: j.rows, ts: j.ts ?? Date.now(), sources: j.sources ?? [], stale: j.stale === true, degraded: j.degraded === true };
  } catch {
    return null;
  }
}

/* The browser's own pool of pools. Each refresh reads the hottest pages plus the next few of the rest from this visitor's own
   connection (so it isn't stuck behind the shared server address that gets refused), folds them in, and keeps the result,
   so within a few refreshes this browser has seen every exchange. Both lists share one read per ~20 seconds. */
const POOL_KEY = "nb_pools";
const POOL_KEEP = 400;
const SHARE_MS = 20_000;
let ownPool: CachedPool[] | null = null;
let ownSlot = 0;
let sharedRead: { at: number; p: Promise<void> } | null = null;

function loadOwnPool(): CachedPool[] {
  if (ownPool) return ownPool;
  try {
    const j = JSON.parse(localStorage.getItem(POOL_KEY) ?? "null") as { rows?: CachedPool[] } | null;
    ownPool = Array.isArray(j?.rows) ? j!.rows!.slice(0, POOL_KEEP) : [];
  } catch { ownPool = []; }
  return ownPool;
}
/** For tests: forget everything this module remembers between calls. */
export function resetOwnPool() { ownPool = null; ownSlot = 0; sharedRead = null; }

async function readOwnPool(f: typeof fetch): Promise<void> {
  const urls = pickSources(KNOWN_DEXES, ownSlot++);
  const pages = (await Promise.allSettled(urls.map((u) => json(f, u)))).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (pages.length === 0) return;
  let rows = mergePools(loadOwnPool(), normalizePools(pages, "agent"), Date.now());
  // reserves make the exit-cost estimate honest, and logos make rows readable; a failure here only costs that detail
  try {
    const want = needsReserves(rows, 60);
    const detail = [];
    for (let i = 0; i < want.length; i += 30) {
      const addrs = want.slice(i, i + 30).map((t) => t.id.replace(/^gt:/, "")).filter((a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a));
      if (addrs.length > 0) detail.push(...parsePairs(await json(f, `${DS}/pairs/solana/${addrs.join(",")}`)));
    }
    if (detail.length > 0) {
      const byId = new Map(enrich(want, detail).map((t) => [t.id, t]));
      rows = rows.map((t) => (byId.has(t.id) ? { ...t, ...byId.get(t.id)!, seen: t.seen } : t));
    }
  } catch { /* keep the rows without reserves */ }
  const logoed = await withOnChainLogos(rows.filter((t) => !t.logo).slice(0, 40), f);
  const logo = new Map(logoed.filter((t) => t.logo).map((t) => [t.id, t.logo]));
  if (logo.size > 0) rows = rows.map((t) => (t.logo ? t : { ...t, logo: logo.get(t.id) }));
  ownPool = rows;
  try { localStorage.setItem(POOL_KEY, JSON.stringify({ rows: rows.slice(0, POOL_KEEP) })); } catch { /* only a speed-up */ }
}

async function direct(kind: Kind, f: typeof fetch): Promise<FeedResult | null> {
  try {
    if (!sharedRead || Date.now() - sharedRead.at > SHARE_MS) sharedRead = { at: Date.now(), p: readOwnPool(f) };
    await sharedRead.p;
    const rows = splitTokens(loadOwnPool())[kind].map((t) => { const { seen: _seen, ...rest } = t as CachedPool; void _seen; return rest as Token; });
    return rows.length === 0 ? null : { rows, ts: Date.now(), sources: rows.some((t) => t.reserveQuoteUsd !== undefined) ? ["geckoterminal", "dexscreener"] : ["geckoterminal"], stale: false };
  } catch {
    return null;
  }
}

/** Both lists' rows together, split by the one shared rule, so a coin can't be in both and each token keeps its deepest pool. */
function union(a: Token[], b: Token[], kind: Kind): Token[] {
  return splitTokens([...a, ...b])[kind];
}

/** A server list shorter than this is topped up from the browser's own connection. */
const THIN = 25;

const good = (r: (FeedResult & { degraded: boolean }) | null): r is FeedResult & { degraded: boolean } => !!r && !r.stale && !r.degraded;

/** Resolves with the first non-null result, or null once every promise has settled empty. */
function firstNonNull<T>(ps: Promise<T | null>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let left = ps.length;
    if (left === 0) return resolve(null);
    for (const p of ps) {
      p.then((v) => {
        if (v !== null) resolve(v);
        else if (--left === 0) resolve(null);
      }).catch(() => {
        if (--left === 0) resolve(null);
      });
    }
  });
}

const HEDGE_MS = 600;

/**
 * Fast path first: our cached endpoint. If it hasn't produced good data within a moment
 * (slow, rate-limited, stale, or built from the backup source), the browser starts its own
 * reads in parallel and whichever good answer lands first wins. Stale or backup-source
 * server rows are only used when nothing better exists, so the list is never empty.
 */
export async function loadFeedRows(kind: Kind, f: typeof fetch = fetch): Promise<FeedResult> {
  const serverP = viaServer(kind, f);
  const serverGood = serverP.then((r) => (good(r) ? r : null));

  // resolve at the hedge delay whether or not the server has answered: a slow server must not stall the list
  const quick = await Promise.race([serverGood, new Promise<null>((r) => setTimeout(() => r(null), HEDGE_MS))]);
  if (quick && quick.rows.length >= THIN) return quick;
  if (quick) {
    // the server's list is thin (its shared address gets refused a lot): add what this browser can read itself
    const own = await direct(kind, f);
    return own ? { ...quick, rows: union(quick.rows, own.rows, kind), sources: [...new Set([...quick.sources, ...own.sources])] } : quick;
  }

  const ownP = direct(kind, f);
  const winner = await firstNonNull<FeedResult>([serverGood, ownP]);
  if (winner) return winner;

  const server = await serverP;
  if (server) return server; // stale / backup-source rows still beat an empty list
  throw new Error("feed unavailable");
}
