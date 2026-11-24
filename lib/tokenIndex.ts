/* Keyless token facts, from Jupiter's token index (with GeckoTerminal's as a second opinion for the same fields). These need no RPC node,
   so they keep working on a deployment that has no SOLANA_RPC_URL yet. Everything is validated; a field that isn't there stays undefined. */

export interface TokenFacts {
  decimals: number;
  /** total supply in whole coins (float: display only) */
  supply?: number;
  holders?: number;
  /** share of supply held by the ten biggest holders, in percent */
  top10Pct?: number;
  mintDisabled?: boolean;
  freezeDisabled?: boolean;
  launchpad?: string;
  /** how many coins this coin's deployer has launched, and how many graduated */
  devMints?: number;
  devMigrations?: number;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const cf = (ttl: number) => ({ cf: { cacheTtl: ttl, cacheEverything: true } }) as RequestInit;

async function fromJupiter(mint: string): Promise<TokenFacts | null> {
  const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000), ...cf(300) });
  if (!r.ok) return null;
  const list = (await r.json()) as unknown;
  const t = Array.isArray(list) ? (list.find((x) => (x as { id?: unknown })?.id === mint) as Record<string, unknown> | undefined) : undefined;
  if (!t) return null;
  const decimals = num(t.decimals);
  if (decimals === undefined || decimals < 0 || decimals > 18) return null;
  const audit = (t.audit && typeof t.audit === "object" ? t.audit : {}) as Record<string, unknown>;
  return {
    decimals,
    supply: num(t.totalSupply),
    holders: num(t.holderCount),
    top10Pct: num(audit.topHoldersPercentage),
    mintDisabled: typeof audit.mintAuthorityDisabled === "boolean" ? audit.mintAuthorityDisabled : undefined,
    freezeDisabled: typeof audit.freezeAuthorityDisabled === "boolean" ? audit.freezeAuthorityDisabled : undefined,
    launchpad: typeof t.launchpad === "string" ? t.launchpad : undefined,
    devMints: num(audit.devMints),
    devMigrations: num(audit.devMigrations),
  };
}

async function fromGecko(mint: string): Promise<TokenFacts | null> {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/info`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000), ...cf(900) });
  if (!r.ok) return null;
  const a = ((await r.json()) as { data?: { attributes?: Record<string, unknown> } }).data?.attributes;
  if (!a) return null;
  const decimals = num(a.decimals);
  if (decimals === undefined) return null;
  const hd = (a.holders && typeof a.holders === "object" ? a.holders : {}) as { count?: unknown; distribution_percentage?: { top_10?: unknown } };
  const top = Number(hd.distribution_percentage?.top_10);
  const flag = (v: unknown): boolean | undefined => (v === "no" ? true : v === "yes" ? false : undefined); // "no authority" = disabled
  return { decimals, holders: num(hd.count), top10Pct: Number.isFinite(top) ? top : undefined, mintDisabled: flag(a.mint_authority), freezeDisabled: flag(a.freeze_authority) };
}

/** Jupiter first, GeckoTerminal if Jupiter can't say. null when neither knows the coin. Never throws. */
export async function tokenFacts(mint: string): Promise<TokenFacts | null> {
  for (const src of [fromJupiter, fromGecko]) {
    try {
      const f = await src(mint);
      if (f) return f;
    } catch {
      /* try the next source */
    }
  }
  return null;
}
