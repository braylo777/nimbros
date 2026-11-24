/* Normalisers for a single pool's chart + tape (GeckoTerminal). Defensive: any
   row that can't be read is dropped, never guessed. */

export interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
export interface PoolTrade { t: number; side: "buy" | "sell"; price: number; size: number; usd: number; tx: string }

export const POOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // a Solana pool address (base58)

/* Candle intervals offered on the chart, and how each maps onto GeckoTerminal's OHLCV.
   `secs` is the bar length, used to snap a fill to the bar it happened in. */
export const RANGE_SPEC = {
  "1m": { frame: "minute", aggregate: 1, limit: 300, secs: 60 },
  "5m": { frame: "minute", aggregate: 5, limit: 300, secs: 300 },
  "15m": { frame: "minute", aggregate: 15, limit: 300, secs: 900 },
  "1H": { frame: "hour", aggregate: 1, limit: 300, secs: 3600 },
  "4H": { frame: "hour", aggregate: 4, limit: 300, secs: 14400 },
  "1D": { frame: "day", aggregate: 1, limit: 300, secs: 86400 },
} as const;
export type RangeId = keyof typeof RANGE_SPEC;

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** ohlcv_list is newest-first; returns oldest-first. */
export function normalizeCandles(json: unknown): Candle[] {
  const list = obj(obj(obj(json).data).attributes).ohlcv_list;
  if (!Array.isArray(list)) return [];
  const out: Candle[] = [];
  for (const r of list) {
    if (!Array.isArray(r)) continue;
    const [t, o, h, l, c, v] = r.map(num);
    if (t === undefined || o === undefined || h === undefined || l === undefined || c === undefined) continue;
    out.push({ t, o, h, l, c, v: v ?? 0 });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function normalizeTrades(json: unknown, limit = 30): PoolTrade[] {
  const data = obj(json).data;
  if (!Array.isArray(data)) return [];
  const out: PoolTrade[] = [];
  for (const raw of data) {
    const a = obj(obj(raw).attributes);
    const kind = a.kind;
    if (kind !== "buy" && kind !== "sell") continue;
    const ts = Date.parse(String(a.block_timestamp));
    // "buy"/"sell" is from the base token's side: buy => base is the coin received
    const price = num(kind === "buy" ? a.price_to_in_usd : a.price_from_in_usd);
    const size = num(kind === "buy" ? a.to_token_amount : a.from_token_amount);
    const usd = num(a.volume_in_usd);
    const tx = typeof a.tx_hash === "string" ? a.tx_hash.slice(0, 80) : "";
    if (!Number.isFinite(ts) || price === undefined || size === undefined || usd === undefined) continue;
    out.push({ t: Math.floor(ts / 1000), side: kind, price, size, usd, tx });
  }
  return out.sort((a, b) => b.t - a.t).slice(0, limit);
}

/** SVG path data for a close-price line + filled area inside w x h with padding. */
export function chartPaths(candles: Candle[], w = 760, h = 240, pad = 10): { line: string; fill: string } | null {
  if (candles.length < 2) return null;
  const closes = candles.map((c) => c.c);
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const span = hi - lo || Math.abs(hi) * 0.001 || 1;
  const x = (i: number) => (i / (closes.length - 1)) * w;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (h - pad * 2);
  const pts = closes.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join("L")}`;
  return { line, fill: `${line}L${w},${h}L0,${h}Z` };
}

/** Bars must be strictly ascending and unique for the chart library; the feed can repeat a bar. */
export function chartBars(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const c of [...candles].sort((a, b) => a.t - b.t)) {
    if (out.length > 0 && out[out.length - 1].t === c.t) out[out.length - 1] = c; // later copy wins
    else out.push(c);
  }
  return out;
}

/** Decimal places that keep a price readable: 4 significant digits, from 2 up to 12. */
export function pricePrecision(price: number): number {
  if (!(price > 0) || !Number.isFinite(price)) return 4;
  const p = Math.ceil(-Math.log10(price)) + 3;
  return Math.max(2, Math.min(12, p));
}

export interface FillMark { time: number; side: "buy" | "sell"; price: number }

/**
 * Put a user's fills on the bar they happened in. A fill before the first bar is
 * dropped; one after the last bar (the feed lags by minutes) goes on the last bar
 * only if it is within two bar lengths (or 30 minutes), so a stale trade never
 * lands on a bar it doesn't belong to.
 */
export function fillMarks(bars: Candle[], fills: { t: number; side: "buy" | "sell"; price: number }[], barSecs: number): FillMark[] {
  if (bars.length === 0) return [];
  const first = bars[0].t;
  const lastT = bars[bars.length - 1].t;
  const grace = Math.max(barSecs * 2, 1800);
  const out: FillMark[] = [];
  for (const f of fills) {
    const ts = Math.floor(f.t / 1000);
    if (ts < first || ts > lastT + grace) continue;
    let bar = bars[bars.length - 1];
    if (ts < lastT) {
      // last bar starting at or before the fill
      let lo = 0, hi = bars.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (bars[mid].t <= ts) lo = mid;
        else hi = mid - 1;
      }
      bar = bars[lo];
    }
    out.push({ time: bar.t, side: f.side, price: f.price });
  }
  return out;
}
