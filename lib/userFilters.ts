import { dexName } from "./dex.ts";
import type { Token } from "./types.ts";

/* The Filters panel on the main page: narrows both Snipe and Scalp by whatever the data actually carries.
   Pure, so it is tested. A criterion left empty is off. A row missing the field a criterion needs (say, no
   age) does NOT pass that criterion: we never count unknown as a match. */

export interface UserFilters {
  q: string;               // name, ticker or contract
  minLiq: number | null;   // USD
  maxLiq: number | null;
  minVol: number | null;   // 24h volume, USD
  maxVol: number | null;
  minMcap: number | null;
  maxMcap: number | null;
  minAgeMin: number | null;
  maxAgeMin: number | null;
  minChange: number | null; // 24h change, %
  maxChange: number | null;
  minTxns: number | null;   // 24h transactions
  maxTxns: number | null;
  minBuyPct: number | null; // share of 24h transactions that are buys, %
  maxBuyPct: number | null;
  minTurn: number | null;   // turnover: 24h volume / liquidity, in x. High = busy for its size
  maxTurn: number | null;
  minLiqPct: number | null; // liquidity as a % of market cap. Low = the market cap is mostly on paper
  maxLiqPct: number | null;
  dex: string[];            // allowed exchanges; empty = all
}

export const EMPTY_FILTERS: UserFilters = { q: "", minLiq: null, maxLiq: null, minVol: null, maxVol: null, minMcap: null, maxMcap: null, minAgeMin: null, maxAgeMin: null, minChange: null, maxChange: null, minTxns: null, maxTxns: null, minBuyPct: null, maxBuyPct: null, minTurn: null, maxTurn: null, minLiqPct: null, maxLiqPct: null, dex: [] };

/** "25k" -> 25000, "1.5m" -> 1500000, "2b", plain numbers, "" -> null. Anything else -> undefined (invalid). */
export function parseAmount(text: string): number | null | undefined {
  const t = text.trim().toLowerCase().replace(/[$,\s]/g, "");
  if (t === "") return null;
  const m = /^(-?\d+(?:\.\d+)?)([kmb])?$/.exec(t);
  if (!m) return undefined;
  const mult = m[2] ? ({ k: 1e3, m: 1e6, b: 1e9 } as Record<string, number>)[m[2]] : 1;
  const n = Number(m[1]) * mult;
  return Number.isFinite(n) ? n : undefined;
}

/** Age text: "30" minutes, "2h", "3d" -> minutes. */
export function parseAge(text: string): number | null | undefined {
  const t = text.trim().toLowerCase().replace(/\s/g, "");
  if (t === "") return null;
  const m = /^(\d+(?:\.\d+)?)([mhd])?$/.exec(t);
  if (!m) return undefined;
  return Number(m[1]) * ({ m: 1, h: 60, d: 1440 } as Record<string, number>)[m[2] ?? "m"];
}

const turnover = (t: Token): number | null => (t.liquidity > 0 && Number.isFinite(t.vol24h) ? t.vol24h / t.liquidity : null);
const liqPct = (t: Token): number | null => (t.marketCap > 0 && t.liquidity >= 0 ? (t.liquidity / t.marketCap) * 100 : null);
const buyPct = (t: Token): number | null => {
  const b = t.buys24h, s = t.sells24h;
  return b !== undefined && s !== undefined && b + s > 0 ? (b / (b + s)) * 100 : null;
};

export function matches(t: Token, f: UserFilters): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && !(t.name.toLowerCase().includes(q) || t.ticker.toLowerCase().includes(q) || t.contract.toLowerCase().includes(q))) return false;
  if (f.dex.length > 0 && !(t.dex && f.dex.includes(t.dex))) return false;
  const inRange = (v: number | undefined | null, lo: number | null, hi: number | null) => {
    if (lo === null && hi === null) return true;
    if (v === undefined || v === null || !Number.isFinite(v)) return false;
    return (lo === null || v >= lo) && (hi === null || v <= hi);
  };
  return (
    inRange(t.liquidity, f.minLiq, f.maxLiq) &&
    inRange(t.vol24h, f.minVol, f.maxVol) &&
    inRange(t.marketCap, f.minMcap, f.maxMcap) &&
    inRange(t.ageMin, f.minAgeMin, f.maxAgeMin) &&
    inRange(t.changePct, f.minChange, f.maxChange) &&
    inRange(t.txns, f.minTxns, f.maxTxns) &&
    inRange(buyPct(t), f.minBuyPct, f.maxBuyPct) &&
    inRange(turnover(t), f.minTurn, f.maxTurn) &&
    inRange(liqPct(t), f.minLiqPct, f.maxLiqPct)
  );
}

export const applyFilters = (rows: Token[], f: UserFilters): Token[] => (activeCount(f) === 0 ? rows : rows.filter((t) => matches(t, f)));

export function activeCount(f: UserFilters): number {
  // a min/max pair on one measure counts once, so the badge says how many things you are filtering on
  const pairs = [[f.minLiq, f.maxLiq], [f.minVol, f.maxVol], [f.minMcap, f.maxMcap], [f.minAgeMin, f.maxAgeMin], [f.minChange, f.maxChange], [f.minTxns, f.maxTxns], [f.minBuyPct, f.maxBuyPct], [f.minTurn, f.maxTurn], [f.minLiqPct, f.maxLiqPct]];
  const on = pairs.filter(([lo, hi]) => lo !== null || hi !== null).length;
  return on + (f.q.trim() ? 1 : 0) + (f.dex.length > 0 ? 1 : 0);
}

/** Presets replace the current filters. Each says exactly what it keeps. */
export const PRESETS: { id: string; label: string; help: string; f: Partial<UserFilters> }[] = [
  { id: "genny", label: "Genny", help: "Under 1 hour old, $50K+ market cap, 500+ trades. Fast runners with real activity.", f: { maxAgeMin: 60, minMcap: 50_000, minTxns: 500 } },
  { id: "fresh", label: "Just launched", help: "Under 1 hour old, at least $2K liquidity", f: { maxAgeMin: 60, minLiq: 2_000 } },
  { id: "graduating", label: "Near graduation", help: "$15K to $25K liquidity, at least $10K volume", f: { minLiq: 15_000, maxLiq: 25_000, minVol: 10_000 } },
  { id: "momentum", label: "Momentum", help: "Up 20%+, $25K+ volume, 55%+ buys, 100+ trades", f: { minChange: 20, minVol: 25_000, minBuyPct: 55, minTxns: 100 } },
  { id: "real", label: "Real liquidity", help: "Liquidity at least 10% of market cap and $25K+", f: { minLiqPct: 10, minLiq: 25_000 } },
];

/* ---- how the panel and the active-filter chips describe each measure ---- */
export type Unit = "usd" | "pct" | "x" | "count" | "age";
export interface Measure { id: string; label: string; hint: string; lo: keyof UserFilters; hi: keyof UserFilters; unit: Unit }

export const MEASURES: Measure[] = [
  { id: "liq", label: "Liquidity", hint: "What the pool holds", lo: "minLiq", hi: "maxLiq", unit: "usd" },
  { id: "mcap", label: "Market cap", hint: "Price × supply", lo: "minMcap", hi: "maxMcap", unit: "usd" },
  { id: "liqpct", label: "Liquidity ÷ market cap", hint: "Low means mostly on paper", lo: "minLiqPct", hi: "maxLiqPct", unit: "pct" },
  { id: "vol", label: "24h volume", hint: "Traded in the last day", lo: "minVol", hi: "maxVol", unit: "usd" },
  { id: "turn", label: "Turnover", hint: "Volume ÷ liquidity", lo: "minTurn", hi: "maxTurn", unit: "x" },
  { id: "txns", label: "24h transactions", hint: "Buys plus sells", lo: "minTxns", hi: "maxTxns", unit: "count" },
  { id: "buy", label: "Buy share", hint: "Buys as % of trades", lo: "minBuyPct", hi: "maxBuyPct", unit: "pct" },
  { id: "chg", label: "24h change", hint: "Price move", lo: "minChange", hi: "maxChange", unit: "pct" },
  { id: "age", label: "Age", hint: "Since the pool opened", lo: "minAgeMin", hi: "maxAgeMin", unit: "age" },
];
/** The panel shows these five by default; the rest sit under "More filters". */
export const PRIMARY: string[] = ["liq", "vol", "mcap", "age", "chg"];
export const MORE: string[] = ["buy", "txns", "turn", "liqpct"];

/** One-tap ranges for each measure. Tapping one sets that measure's min/max; tapping it again clears it. */
export interface Quick { label: string; lo?: number; hi?: number }
export const QUICK: Record<string, Quick[]> = {
  liq: [{ label: "Under $10K", hi: 10_000 }, { label: "$10K–25K", lo: 10_000, hi: 25_000 }, { label: "$25K–100K", lo: 25_000, hi: 100_000 }, { label: "$100K+", lo: 100_000 }],
  vol: [{ label: "$5K+", lo: 5_000 }, { label: "$25K+", lo: 25_000 }, { label: "$100K+", lo: 100_000 }, { label: "$500K+", lo: 500_000 }],
  mcap: [{ label: "Under $100K", hi: 100_000 }, { label: "$100K–1M", lo: 100_000, hi: 1_000_000 }, { label: "$1M–10M", lo: 1_000_000, hi: 10_000_000 }, { label: "$10M+", lo: 10_000_000 }],
  age: [{ label: "Under 1h", hi: 60 }, { label: "Under 6h", hi: 360 }, { label: "Under 24h", hi: 1440 }, { label: "Over 7d", lo: 10_080 }],
  chg: [{ label: "Rising", lo: 0 }, { label: "Up 25%+", lo: 25 }, { label: "Falling", hi: 0 }, { label: "Down 25%+", hi: -25 }],
  buy: [{ label: "Buyers ahead", lo: 55 }, { label: "Sellers ahead", hi: 45 }],
  txns: [{ label: "100+", lo: 100 }, { label: "500+", lo: 500 }, { label: "2K+", lo: 2_000 }],
  turn: [{ label: "Busy 1x+", lo: 1 }, { label: "Hot 3x+", lo: 3 }],
  liqpct: [{ label: "Backed 10%+", lo: 10 }, { label: "Thin under 3%", hi: 3 }],
};

const same = (a: number | null, b: number | undefined) => a === (b === undefined ? null : b);
export function quickOn(f: UserFilters, m: Measure, q: Quick): boolean {
  return same(f[m.lo] as number | null, q.lo) && same(f[m.hi] as number | null, q.hi);
}
/** Tap a quick range: sets it, or clears the measure if it was already on. */
export function toggleQuick(f: UserFilters, m: Measure, q: Quick): UserFilters {
  return quickOn(f, m, q) ? { ...f, [m.lo]: null, [m.hi]: null } : { ...f, [m.lo]: q.lo ?? null, [m.hi]: q.hi ?? null };
}
/** True when the measure has a range that isn't one of the quick ones (so the panel shows its custom boxes). */
export function isCustom(f: UserFilters, m: Measure): boolean {
  const lo = f[m.lo] as number | null, hi = f[m.hi] as number | null;
  if (lo === null && hi === null) return false;
  return !(QUICK[m.id] ?? []).some((q) => quickOn(f, m, q));
}

/** 25000 -> "25k", 1500000 -> "1.5m". Round-trips through parseAmount. */
export function compact(n: number): string {
  const a = Math.abs(n);
  const f = (v: number, s: string) => `${Number(v.toFixed(2))}${s}`;
  return a >= 1e9 ? f(n / 1e9, "b") : a >= 1e6 ? f(n / 1e6, "m") : a >= 1e3 ? f(n / 1e3, "k") : String(Number(n.toFixed(2)));
}
/** 90 -> "90", 120 -> "2h", 2880 -> "2d". Round-trips through parseAge. */
export const compactAge = (m: number): string => (m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : String(m));

const show = (n: number, u: Unit): string => (u === "usd" ? `$${compact(n)}` : u === "pct" ? `${compact(n)}%` : u === "x" ? `${compact(n)}x` : u === "age" ? compactAge(n) : compact(n));

/** One chip per active thing, e.g. "Liquidity ≥ $25k", "Age ≤ 6h", "Exchange: cetus". */
export function activeChips(f: UserFilters): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  if (f.q.trim()) out.push({ id: "q", label: `Search: ${f.q.trim()}` });
  for (const m of MEASURES) {
    const lo = f[m.lo] as number | null, hi = f[m.hi] as number | null;
    if (lo === null && hi === null) continue;
    out.push({ id: m.id, label: lo !== null && hi !== null ? `${m.label} ${show(lo, m.unit)} to ${show(hi, m.unit)}` : lo !== null ? `${m.label} ≥ ${show(lo, m.unit)}` : `${m.label} ≤ ${show(hi as number, m.unit)}` });
  }
  if (f.dex.length > 0) out.push({ id: "dex", label: `Exchange: ${f.dex.map(dexName).join(", ")}` });
  return out;
}

/** Remove one chip's worth of filtering. */
export function clearChip(f: UserFilters, id: string): UserFilters {
  if (id === "q") return { ...f, q: "" };
  if (id === "dex") return { ...f, dex: [] };
  const m = MEASURES.find((x) => x.id === id);
  return m ? { ...f, [m.lo]: null, [m.hi]: null } : f;
}

/** True when the filters are exactly a preset's (so the panel can show it as selected). */
export const isPreset = (f: UserFilters, preset: Partial<UserFilters>): boolean =>
  JSON.stringify({ ...EMPTY_FILTERS, ...preset }) === JSON.stringify({ ...EMPTY_FILTERS, ...f });
