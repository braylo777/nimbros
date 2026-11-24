/* Multi-chain discovery: new and trending pools on other chains, read from GeckoTerminal. Pure and defensive like lib/feeds.ts: upstream JSON is
   untrusted, a row that can't be read is dropped, a missing field stays undefined. Discovery only: swaps stay Solana-only, other chains link out. */

export const CHAINS = {
  base: { id: "base", name: "Base", network: "base", explorer: "https://basescan.org/token/", address: /^0x[0-9a-fA-F]{40}$/ },
  bsc: { id: "bsc", name: "BNB Chain", network: "bsc", explorer: "https://bscscan.com/token/", address: /^0x[0-9a-fA-F]{40}$/ },
  eth: { id: "eth", name: "Ethereum", network: "eth", explorer: "https://etherscan.io/token/", address: /^0x[0-9a-fA-F]{40}$/ },
} as const;
export type ChainId = keyof typeof CHAINS;
export const isChain = (v: unknown): v is ChainId => typeof v === "string" && Object.prototype.hasOwnProperty.call(CHAINS, v);

export interface ChainRow {
  id: string; chain: ChainId; name: string; ticker: string; logo?: string; dex?: string; poolUrl: string; explorerUrl: string; contract: string;
  price: number; changePct: number; liquidity: number; vol24h: number; marketCap: number; ageMin?: number; buys?: number; sells?: number; flags: string[];
}

const num = (v: unknown): number | undefined => { const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : undefined; };
const str = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const https = (v: unknown): string | undefined => { const s = str(v, 500); return s && s.startsWith("https://") ? s : undefined; };

export const MIN_LIQ_USD = 2_000;

/** Cheap, honest red flags from the pool's own numbers. These are hints, not a honeypot scan (that needs a simulation per chain). */
export function flagsOf(r: Pick<ChainRow, "liquidity" | "vol24h" | "marketCap" | "ageMin" | "buys" | "sells">): string[] {
  const f: string[] = [];
  if (r.liquidity < 10_000) f.push("thin liquidity");
  if (r.ageMin !== undefined && r.ageMin < 60) f.push("under an hour old");
  if (r.buys !== undefined && r.sells !== undefined && r.buys >= 20 && r.sells === 0) f.push("buys only, nobody has sold (honeypot pattern)");
  if (r.liquidity > 0 && r.vol24h / r.liquidity > 50) f.push("volume far above liquidity");
  if (r.marketCap > 0 && r.liquidity > 0 && r.liquidity / r.marketCap < 0.01) f.push("liquidity under 1% of market cap");
  return f;
}

export function normalizeChainPools(json: unknown, chain: ChainId, now = Date.now()): ChainRow[] {
  const pages = Array.isArray(json) ? json : [json];
  const data = pages.flatMap((j) => (Array.isArray(rec(j).data) ? (rec(j).data as unknown[]) : []));
  const included = pages.flatMap((j) => (Array.isArray(rec(j).included) ? (rec(j).included as unknown[]) : []));
  const tokens = new Map<string, Record<string, unknown>>();
  for (const i of included) { const t = rec(i); const id = str(t.id); if (id) tokens.set(id, rec(t.attributes)); }
  const c = CHAINS[chain];
  const best = new Map<string, ChainRow>();
  for (const raw of data) {
    const p = rec(raw), a = rec(p.attributes);
    const pool = str(a.address);
    const price = num(a.base_token_price_usd);
    const baseId = str(rec(rec(rec(p.relationships).base_token).data).id);
    const contract = baseId?.replace(/^[a-z0-9-]+_/, "");
    if (!pool || !contract || !c.address.test(contract) || price === undefined || price <= 0) continue;
    const liq = num(a.reserve_in_usd) ?? 0;
    if (liq < MIN_LIQ_USD) continue;
    const base = (baseId && tokens.get(baseId)) || {};
    const symbol = str(base.symbol, 24) ?? str(a.name, 60)?.split(" / ")[0]?.slice(0, 24);
    if (!symbol) continue;
    const created = str(a.pool_created_at);
    const tx = rec(rec(a.transactions).h24);
    const row: ChainRow = {
      id: `${chain}:${pool}`, chain, name: str(base.name, 60) ?? symbol, ticker: symbol, logo: https(base.image_url),
      dex: str(rec(rec(rec(p.relationships).dex).data).id, 40), poolUrl: `https://www.geckoterminal.com/${c.network}/pools/${pool}`, explorerUrl: c.explorer + contract, contract,
      price, changePct: num(rec(a.price_change_percentage).h24) ?? 0, liquidity: liq, vol24h: num(rec(a.volume_usd).h24) ?? 0, marketCap: num(a.market_cap_usd) ?? num(a.fdv_usd) ?? 0,
      ageMin: created && Date.parse(created) ? Math.max(0, Math.floor((now - Date.parse(created)) / 60_000)) : undefined,
      buys: num(tx.buys), sells: num(tx.sells), flags: [],
    };
    row.flags = flagsOf(row);
    const cur = best.get(contract);
    if (!cur || row.liquidity > cur.liquidity) best.set(contract, row);
  }
  return [...best.values()].sort((a, b) => (a.ageMin ?? Infinity) - (b.ageMin ?? Infinity) || b.liquidity - a.liquidity).slice(0, 60);
}
