/* Watchlist: a small set of pool ids plus the price/liquidity seen when each was
   added, so "what changed since you looked" is arithmetic on real data, never a
   guess. Pure helpers here; storage is in watchStore.ts. */

export interface WatchItem {
  id: string;
  ticker: string;
  name: string;
  logo?: string;
  addedAt: number;
  priceAtAdd: number;
  liquidityAtAdd: number;
}

export const MAX_WATCH = 30;

export interface WatchChange {
  item: WatchItem;
  priceChangePct: number | null;
  liquidityChangePct: number | null;
  /** true when the coin is in neither live list right now, so no current numbers exist */
  missing: boolean;
}

const pctChange = (from: number, to: number): number | null => (from > 0 && Number.isFinite(to) ? (to / from - 1) * 100 : null);

/** Compare each watched coin with what the live feeds show now. */
export function changesFor(
  items: WatchItem[],
  live: { id: string; price: number; liquidity: number }[]
): WatchChange[] {
  const byId = new Map(live.map((t) => [t.id, t]));
  return items.map((item) => {
    const now = byId.get(item.id);
    if (!now) return { item, priceChangePct: null, liquidityChangePct: null, missing: true };
    return {
      item,
      priceChangePct: pctChange(item.priceAtAdd, now.price),
      liquidityChangePct: pctChange(item.liquidityAtAdd, now.liquidity),
      missing: false,
    };
  });
}

/** Defensive parse: anything malformed is dropped, the list is capped, ids are de-duplicated. */
export function parseWatch(raw: string | null): WatchItem[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    const seen = new Set<string>();
    const out: WatchItem[] = [];
    for (const x of j) {
      const o = x as Partial<WatchItem> | null;
      if (!o || typeof o.id !== "string" || typeof o.ticker !== "string" || seen.has(o.id)) continue;
      if (!(typeof o.priceAtAdd === "number" && o.priceAtAdd > 0) || typeof o.addedAt !== "number") continue;
      seen.add(o.id);
      out.push({
        id: o.id.slice(0, 100),
        ticker: o.ticker.slice(0, 24),
        name: typeof o.name === "string" ? o.name.slice(0, 60) : o.ticker.slice(0, 24),
        logo: typeof o.logo === "string" && o.logo.startsWith("https://") ? o.logo : undefined,
        addedAt: o.addedAt,
        priceAtAdd: o.priceAtAdd,
        liquidityAtAdd: typeof o.liquidityAtAdd === "number" && o.liquidityAtAdd >= 0 ? o.liquidityAtAdd : 0,
      });
      if (out.length >= MAX_WATCH) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function toggleWatch(items: WatchItem[], next: WatchItem): WatchItem[] {
  if (items.some((i) => i.id === next.id)) return items.filter((i) => i.id !== next.id);
  return [next, ...items].slice(0, MAX_WATCH);
}
