import type { Token } from "./types.ts";

/* DexScreener: a second source for the live lists AND the only one that reports
   real pool reserves, which is what lets the exit-cost math model a fill with an
   actual constant-product curve instead of a flat formula.

   Pure and defensive: upstream JSON is untrusted, a row that can't be read is
   dropped, and a missing field stays `undefined` rather than being guessed. */

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const str = (v: unknown, max = 200): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const httpsUrl = (v: unknown): string | undefined => {
  const s = str(v, 500);
  return s && s.startsWith("https://") ? s : undefined;
};

/**
 * The project's own links, as DexScreener reports them: `info.socials` (typed handles) plus
 * `info.websites`. Only https survives, types are normalised to lowercase, and the list is capped —
 * these are rendered as clickable links, so nothing unvalidated gets through.
 */
export function socialsOf(info: unknown): { type: string; url: string }[] {
  const i = obj(info);
  const out: { type: string; url: string }[] = [];
  const push = (type: unknown, url: unknown) => {
    const u = httpsUrl(url);
    const t = str(type, 20)?.toLowerCase().replace(/[^a-z]/g, "");
    if (u && out.length < 6 && !out.some((x) => x.url === u)) out.push({ type: t || "link", url: u });
  };
  if (Array.isArray(i.socials)) for (const s of i.socials.slice(0, 12)) push(obj(s).type, obj(s).url);
  if (Array.isArray(i.websites)) for (const w of i.websites.slice(0, 12)) push(obj(w).label ?? "website", obj(w).url);
  return out;
}

export interface Reserves {
  /** base tokens held by the pool */
  base: number;
  /** USD value of the NON-base side — what a buyer pays into */
  quoteUsd: number;
}

/**
 * Quote-side USD depth, derived from what DexScreener reports:
 * total pool USD minus the base side's USD value. Returns undefined when the
 * numbers don't hang together (negative or absurd), so a bad row can never
 * make a trade look cheaper than it is.
 */
export function reservesOf(liquidityUsd?: number, base?: number, priceUsd?: number): Reserves | undefined {
  if (liquidityUsd === undefined || base === undefined || priceUsd === undefined) return undefined;
  if (!(liquidityUsd > 0) || !(base > 0) || !(priceUsd > 0)) return undefined;
  const baseUsd = base * priceUsd;
  const quoteUsd = liquidityUsd - baseUsd;
  // a healthy pool holds meaningful value on both sides; anything else we treat as unknown
  if (!(quoteUsd > 0) || quoteUsd > liquidityUsd) return undefined;
  return { base, quoteUsd };
}

export interface DsPair {
  pairAddress: string;
  quoteSymbol: string;
  token: Token;
  reserves?: Reserves;
}

/** Accepts either `{pairs:[...]}` or a bare array of pairs. */
export function parsePairs(json: unknown): DsPair[] {
  const root = obj(json);
  const list = Array.isArray(root.pairs) ? root.pairs : Array.isArray(json) ? (json as unknown[]) : [];
  const out: DsPair[] = [];
  for (const raw of list) {
    const p = obj(raw);
    if (str(p.chainId) !== "solana") continue;
    const pairAddress = str(p.pairAddress, 80);
    const base = obj(p.baseToken);
    const symbol = str(base.symbol, 24);
    const contract = str(base.address, 300);
    const price = num(p.priceUsd);
    if (!pairAddress || !symbol || !contract || price === undefined || price <= 0) continue;

    const liq = obj(p.liquidity);
    const liquidityUsd = num(liq.usd) ?? 0;
    const tx = obj(obj(p.txns).h24);
    const buys = num(tx.buys);
    const sells = num(tx.sells);
    const created = num(p.pairCreatedAt);
    const socials = socialsOf(p.info);

    out.push({
      pairAddress,
      quoteSymbol: (str(obj(p.quoteToken).symbol, 24) ?? "").toUpperCase(),
      reserves: reservesOf(liquidityUsd, num(liq.base), price),
      token: {
        id: `gt:${pairAddress}`, // same id space as GeckoTerminal: both key on the pool address
        kind: "snipe",
        live: true,
        name: str(base.name, 60) ?? symbol,
        ticker: symbol,
        logo: httpsUrl(obj(p.info).imageUrl),
        socials,
        hasSocial: socials.length > 0,
        dex: str(p.dexId, 40),
        poolUrl: `https://dexscreener.com/solana/${pairAddress}`,
        price,
        changePct: num(obj(p.priceChange).h24) ?? 0,
        marketCap: num(p.marketCap) ?? num(p.fdv) ?? 0,
        liquidity: liquidityUsd,
        vol24h: num(obj(p.volume).h24) ?? 0,
        txns: buys !== undefined && sells !== undefined ? buys + sells : 0,
        buys24h: buys,
        sells24h: sells,
        contract,
        ageMin: created !== undefined ? Math.max(0, Math.floor((Date.now() - created) / 60_000)) : undefined,
      },
    });
  }
  return out;
}

/**
 * Merge DexScreener detail into rows discovered elsewhere (same pool address).
 * Only fills gaps and adds reserves — it never overwrites a price or a volume
 * that the primary source already gave, so one view of the market stays canonical.
 */
export function enrich(rows: Token[], pairs: DsPair[]): Token[] {
  const byId = new Map(pairs.map((p) => [p.token.id, p]));
  return rows.map((t) => {
    const p = byId.get(t.id);
    if (!p) return t;
    return {
      ...t,
      logo: t.logo ?? p.token.logo,
      marketCap: t.marketCap || p.token.marketCap,
      reserveBase: p.reserves?.base,
      reserveQuoteUsd: p.reserves?.quoteUsd,
    };
  });
}

/** Rows from the fallback source, kept only if they pass the same gate as the primary. */
export function fallbackRows(pairs: DsPair[], kind: "snipe" | "agent", keep: (t: Token, p: DsPair) => boolean): Token[] {
  const seen = new Map<string, Token>();
  for (const p of pairs) {
    const t: Token = { ...p.token, kind, reserveBase: p.reserves?.base, reserveQuoteUsd: p.reserves?.quoteUsd };
    if (!keep(t, p)) continue;
    const cur = seen.get(t.contract);
    if (!cur || t.liquidity > cur.liquidity) seen.set(t.contract, t);
  }
  return [...seen.values()];
}
