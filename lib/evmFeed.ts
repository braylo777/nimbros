import type { Token } from "./types.ts";
import { CHAINS, EVM_CHAINS, type ChainId } from "./chains.ts";

/* Read-only browse for the EVM chains: normalizes GeckoTerminal pools the same way the Solana feed does (see lib/feeds.ts), generalized
   to any chain's own network slug and wrapped-native quote token. No trading here yet — these rows are for looking, not for signing;
   a QuickBuy/Close for EVM comes later (see .claude/brain/multichain-launch.md). Kept in its own file, on purpose: it never touches the
   Solana feed pipeline, so a bug here cannot regress the working Snipe/Scalp lists. */

const num = (v: unknown): number | undefined => { const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN; return Number.isFinite(n) ? n : undefined; };
const str = (v: unknown, max = 200): string | undefined => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const httpsUrl = (v: unknown): string | undefined => { const s = str(v, 500); return s && s.startsWith("https://") ? s : undefined; };

export const GRADUATION_LIQ_USD = 25_000;
export const DUST_LIQ_USD = 1_000;
export type EvmStage = "snipe" | "scalp";

export function isEvmChain(id: string): id is ChainId { return EVM_CHAINS.some((c) => c.id === id); }

export function evmSourceUrls(chainId: ChainId): string[] {
  const c = CHAINS[chainId];
  const GT = `https://api.geckoterminal.com/api/v2/networks/${c.geckoNetwork}`;
  return [`${GT}/new_pools?include=base_token&page=1`, `${GT}/trending_pools?include=base_token&page=1`, `${GT}/pools?include=base_token&page=1&sort=h24_volume_usd_desc`];
}

/** Same shape and quality bar as lib/feeds.ts normalizePools, generalized to any EVM chain. */
export function normalizeEvmPools(pages: unknown[], chainId: ChainId, now = Date.now()): Token[] {
  const chain = CHAINS[chainId];
  const wrapped = (chain.wrapped ?? "").toLowerCase();
  const data = pages.flatMap((j) => (Array.isArray(rec(j).data) ? (rec(j).data as unknown[]) : []));
  const included = pages.flatMap((j) => (Array.isArray(rec(j).included) ? (rec(j).included as unknown[]) : []));
  const tokens = new Map<string, Record<string, unknown>>();
  for (const i of included) { const t = rec(i); const id = str(t.id); if (id) tokens.set(id, rec(t.attributes)); }

  const out: Token[] = [];
  for (const raw of data) {
    const p = rec(raw);
    const a = rec(p.attributes);
    const address = str(a.address);
    const price = num(a.base_token_price_usd);
    if (!address || price === undefined || price <= 0) continue;
    const baseId = str(rec(rec(rec(p.relationships).base_token).data).id);
    const base = (baseId && tokens.get(baseId)) || {};
    const poolName = str(a.name, 60) ?? "";
    const symbol = str(base.symbol, 24) ?? poolName.split(" / ")[0]?.slice(0, 24);
    if (!symbol) continue;
    const quoteId = (str(rec(rec(rec(p.relationships).quote_token).data).id) ?? "").split("_").pop()?.toLowerCase();
    if (wrapped && quoteId !== wrapped) continue; // memecoin-style pools only: quoted in the chain's own native token
    const liq = num(a.reserve_in_usd) ?? 0;
    if (liq < DUST_LIQ_USD) continue;
    const created = str(a.pool_created_at);
    const tx24 = rec(rec(a.transactions).h24);
    const buys = num(tx24.buys), sells = num(tx24.sells);
    out.push({
      id: `${chainId}:${address}`,
      kind: "snipe",
      live: true,
      name: str(base.name, 60) ?? symbol,
      ticker: symbol,
      logo: httpsUrl(base.image_url),
      dex: str(rec(rec(rec(p.relationships).dex).data).id, 40),
      poolUrl: `https://www.geckoterminal.com/${chain.geckoNetwork}/pools/${address}`,
      price,
      changePct: num(rec(a.price_change_percentage).h24) ?? 0,
      marketCap: num(a.market_cap_usd) ?? num(a.fdv_usd) ?? 0,
      liquidity: liq,
      vol24h: num(rec(a.volume_usd).h24) ?? 0,
      txns: buys !== undefined && sells !== undefined ? buys + sells : 0,
      buys24h: buys,
      sells24h: sells,
      contract: baseId ? baseId.split("_").pop()! : address,
      ageMin: created && Date.parse(created) ? Math.max(0, Math.floor((now - Date.parse(created)) / 60_000)) : undefined,
    });
  }
  const best = new Map<string, Token>();
  for (const t of out) { const cur = best.get(t.contract); if (!cur || t.liquidity > cur.liquidity) best.set(t.contract, t); }
  return [...best.values()];
}

/** Split by the same graduation liquidity used on Solana; a coin under 24h old with real volume counts as Snipe, older-with-liquidity as Scalp. */
export function splitEvmTokens(rows: Token[]): Record<EvmStage, Token[]> {
  const snipe: Token[] = [], scalp: Token[] = [];
  for (const t of rows) {
    const fresh = t.ageMin !== undefined && t.ageMin < 24 * 60;
    if (fresh) snipe.push(t); else if (t.liquidity >= GRADUATION_LIQ_USD) scalp.push({ ...t, kind: "agent" });
  }
  snipe.sort((a, b) => (a.ageMin ?? Infinity) - (b.ageMin ?? Infinity) || b.liquidity - a.liquidity);
  scalp.sort((a, b) => b.vol24h - a.vol24h);
  return { snipe: snipe.slice(0, 60), scalp: scalp.slice(0, 60) };
}
