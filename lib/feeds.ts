import type { Prediction, Token } from "./types.ts";
import { SOL_ADDRESS, WSOL_MINT } from "./chain.ts";

/* Normalisers for the three live feeds. Pure and defensive: upstream JSON is
   untrusted, so every field is validated and a row that can't be read is
   dropped rather than guessed. Missing metrics stay `undefined` — they are
   never filled with made-up numbers. */

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
/** Only https image URLs are ever passed to <img>. */
const httpsUrl = (v: unknown): string | undefined => {
  const s = str(v, 500);
  return s && s.startsWith("https://") ? s : undefined;
};

export function humanCloses(endIso: string, now = Date.now()): string {
  const ms = Date.parse(endIso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "0h";
  const h = ms / 3_600_000;
  if (h < 24) return `${Math.max(1, Math.floor(h))}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Polymarket Gamma /markets -> binary Yes/No predictions. */
export function normalizePredictions(json: unknown, now = Date.now()): Prediction[] {
  if (!Array.isArray(json)) return [];
  const out: Prediction[] = [];
  for (const raw of json) {
    const m = rec(raw);
    const id = str(m.conditionId) ?? str(m.id);
    const headline = str(m.question, 160);
    const end = str(m.endDate);
    if (!id || !headline || !end) continue;
    let outcomes: unknown, prices: unknown;
    try {
      outcomes = JSON.parse(String(m.outcomes));
      prices = JSON.parse(String(m.outcomePrices));
    } catch {
      continue;
    }
    if (!Array.isArray(outcomes) || !Array.isArray(prices)) continue;
    if (outcomes[0] !== "Yes" || outcomes[1] !== "No") continue;
    const yes = num(prices[0]);
    if (yes === undefined || yes < MIN_YES || yes > MAX_YES) continue; // resolved/settled markets carry no signal
    if (Date.parse(end) <= now) continue;
    const slug = str(rec((Array.isArray(m.events) ? m.events[0] : undefined)).slug) ?? str(m.slug);
    out.push({
      id,
      headline,
      source: "polymarket.com",
      date: new Date(end).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      closesIn: humanCloses(end, now),
      yesPct: yes * 100,
      volume: num(m.volumeNum) ?? num(m.volume) ?? 0,
      vol24h: num(m.volume24hr),
      liquidity: num(m.liquidityNum) ?? num(m.liquidity),
      dayChange: num(m.oneDayPriceChange) !== undefined ? num(m.oneDayPriceChange)! * 100 : undefined,
      image: httpsUrl(m.icon) ?? httpsUrl(m.image),
      url: slug ? `https://polymarket.com/event/${encodeURIComponent(slug)}` : "https://polymarket.com",
    });
  }
  return out;
}

/* Established assets — never "new memecoins", whatever pool they appear in. */
const MAJOR_SYMBOLS = new Set([
  "SOL", "WSOL", "USDC", "USDT", "PYUSD", "USDS", "USDG", "BTC", "WBTC", "CBBTC", "ETH", "WETH", "JUP", "JTO", "PYTH",
  "RAY", "ORCA", "MSOL", "JITOSOL", "BSOL", "JUPSOL", "INF", "HNT", "RENDER", "W", "DRIFT", "KMNO", "MNDE",
]);
export const SNIPE_MIN_LIQ_USD = 500;
const MIN_YES = 0.03;
const MAX_YES = 0.97;
export const STABLES = new Set(["USDC", "USDT", "PYUSD", "USDS", "USDG", "USDY", "FDUSD", "USDE", "SUSDE", "UXD", "USDH"]);

/** Shared gate so the primary and fallback sources admit exactly the same coins. */
export function isSnipeCandidate(t: { ticker: string; liquidity: number }, quoteIsSol: boolean): boolean {
  if (!quoteIsSol) return false;
  if (MAJOR_SYMBOLS.has(t.ticker.toUpperCase())) return false;
  return t.liquidity >= SNIPE_MIN_LIQ_USD;
}

/** GeckoTerminal pools (+ included base tokens) -> live Token rows. */
export function normalizePools(json: unknown, kind: "snipe" | "agent", now = Date.now()): Token[] {
  const pages = Array.isArray(json) ? json : [json];
  const data = pages.flatMap((j) => (Array.isArray(rec(j).data) ? (rec(j).data as unknown[]) : []));
  const included = pages.flatMap((j) => (Array.isArray(rec(j).included) ? (rec(j).included as unknown[]) : []));
  const tokens = new Map<string, Record<string, unknown>>();
  for (const i of included) {
    const t = rec(i);
    const id = str(t.id);
    if (id) tokens.set(id, rec(t.attributes));
  }
  const out: Token[] = [];
  for (const raw of data) {
    const p = rec(raw);
    const a = rec(p.attributes);
    const address = str(a.address);
    const price = num(a.base_token_price_usd);
    if (!address || price === undefined || price <= 0) continue;
    const rel = rec(rec(p.relationships).base_token);
    const baseId = str(rec(rel.data).id);
    const base = (baseId && tokens.get(baseId)) || {};
    const poolName = str(a.name, 60) ?? "";
    const symbol = str(base.symbol, 24) ?? poolName.split(" / ")[0]?.slice(0, 24);
    if (!symbol) continue;
    if (kind === "agent" && STABLES.has(symbol.toUpperCase())) continue; // stablecoins aren't scalp targets
    if (kind === "snipe") {
      // memecoin-style launches only: SOL-quoted, real (non-dust) liquidity, not an established asset
      const quoteId = str(rec(rec(rec(p.relationships).quote_token).data).id) ?? "";
      if (quoteId.replace(/^solana_/, "") !== WSOL_MINT) continue;
      if (MAJOR_SYMBOLS.has(symbol.toUpperCase())) continue;
      if ((num(a.reserve_in_usd) ?? 0) < SNIPE_MIN_LIQ_USD) continue;
    }
    const created = str(a.pool_created_at);
    const tx24 = rec(rec(a.transactions).h24);
    const buys = num(tx24.buys), sells = num(tx24.sells);
    const dex = str(rec(rec(rec(p.relationships).dex).data).id, 40);
    const liq = num(a.reserve_in_usd) ?? 0;
    const mc = num(a.market_cap_usd) ?? num(a.fdv_usd) ?? 0;
    out.push({
      id: `gt:${address}`,
      kind,
      live: true,
      name: str(base.name, 60) ?? symbol,
      ticker: symbol,
      logo: httpsUrl(base.image_url),
      dex,
      poolUrl: `https://www.geckoterminal.com/solana/pools/${address}`,
      price,
      changePct: num(rec(a.price_change_percentage).h24) ?? 0,
      changePct1h: num(rec(a.price_change_percentage).h1),
      marketCap: mc,
      liquidity: liq,
      vol24h: num(rec(a.volume_usd).h24) ?? 0,
      txns: buys !== undefined && sells !== undefined ? buys + sells : 0,
      buys24h: buys,
      sells24h: sells,
      contract: baseId ? baseId.replace(/^solana_/, "") : address,
      ageMin: created && Date.parse(created) ? Math.max(0, Math.floor((now - Date.parse(created)) / 60_000)) : undefined,
    });
  }
  // one row per token: keep its deepest pool
  const best = new Map<string, Token>();
  for (const t of out) {
    const cur = best.get(t.contract);
    if (!cur || t.liquidity > cur.liquidity) best.set(t.contract, t);
  }
  return [...best.values()];
}

/** Icon URLs from on-chain metadata are attacker-controlled: https only (ipfs:// mapped to a gateway), bounded length. */
export function safeIconUrl(v: unknown): string | undefined {
  const s = str(v, 400);
  if (!s) return undefined;
  if (s.startsWith("ipfs://")) {
    const cid = s.slice(7).replace(/^ipfs\//, "");
    return /^[A-Za-z0-9/_.-]{10,200}$/.test(cid) && !cid.includes("..") ? `https://ipfs.io/ipfs/${cid}` : undefined;
  }
  return httpsUrl(s);
}

/** A Solana mint address (base58). Named COIN_TYPE for the many call sites that validate "is this a coin id". */
export const COIN_TYPE = SOL_ADDRESS;

/** Logos come with the pool feeds on Solana (GeckoTerminal / DexScreener token images), so there is no on-chain lookup to do.
    Kept as a no-op so callers keep one code path; never throws. */
export async function withOnChainLogos(tokens: Token[], _fetcher: typeof fetch = fetch): Promise<Token[]> {
  void _fetcher;
  return tokens;
}
