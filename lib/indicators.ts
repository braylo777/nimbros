import type { Candle } from "./pool.ts";

/** Wilder's RSI over closes. Needs period+1 bars; returns null otherwise. */
export function rsi(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const c = candles.map((x) => x.c);
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = c[i] - c[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / period, al = loss / period;
  for (let i = period + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (al === 0) return ag === 0 ? 50 : 100;
  return 100 - 100 / (1 + ag / al);
}

/** Highest traded price across the bars we have. */
export function highOf(candles: Candle[]): number | null {
  if (candles.length === 0) return null;
  return candles.reduce((m, x) => (x.h > m ? x.h : m), 0) || null;
}

/** RSI at every bar from index `period` on, for drawing under the chart. One pass (Wilder's smoothing carried forward), so a chart
    with thousands of bars from launch costs the same as one with a few hundred. Matches `rsi()` at every point. */
export function rsiSeries(candles: Candle[], period = 14): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  if (candles.length < period + 1) return out;
  const at = (ag: number, al: number) => (al === 0 ? (ag === 0 ? 50 : 100) : 100 - 100 / (1 + ag / al));
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].c - candles[i - 1].c;
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / period, al = loss / period;
  out.push({ t: candles[period].t, v: at(ag, al) });
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].c - candles[i - 1].c;
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    out.push({ t: candles[i].t, v: at(ag, al) });
  }
  return out;
}

/** Simple moving average of a series (the RSI's smoothing line). Points before `len` values exist are omitted. */
export function smaSeries(points: { t: number; v: number }[], len = 14): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = [];
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += points[i].v;
    if (i >= len) sum -= points[i - len].v;
    if (i >= len - 1) out.push({ t: points[i].t, v: sum / len });
  }
  return out;
}

/* ---- NimBros OFI reference (nmbr trading edge, section 11): big-trade bubbles and volume-weighted candle tone ---- */

export type BubbleKind = "sellers-absorbed" | "buyers-absorbed" | "accepted-buying" | "accepted-selling" | "contested";
export interface Bubble { t: number; kind: BubbleKind; bias: "bullish" | "bearish" | "neutral"; /** volume as a multiple of the recent average */ size: number; large: boolean }

export const BT = { window: 20, volMult: 1.6, sideShare: 0.35, wick: 0.4, body: 0.45, closeZone: 0.55, largeMult: 3 } as const;

/** A bar whose volume reaches 1.6x its 20-bar average is a "big trade". What it says depends on its shape:
    long lower wick closing high = sellers absorbed (bullish); long upper wick closing low = buyers absorbed (bearish); a strong body up or
    down = accepted buying or selling; both sides carrying 35%+ of the volume = contested. Buy/sell share is estimated from where the bar
    closed inside its range, the range-based estimate the indicator itself uses on finished bars. */
export function bigTrades(bars: Candle[]): Bubble[] {
  const out: Bubble[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i >= BT.window) {
      const avg = sum / BT.window;
      const range = b.h - b.l;
      if (avg > 0 && b.v >= BT.volMult * avg && range > 0) {
        const size = b.v / avg;
        const lowerWick = (Math.min(b.o, b.c) - b.l) / range;
        const upperWick = (b.h - Math.max(b.o, b.c)) / range;
        const body = Math.abs(b.c - b.o) / range;
        const closePos = (b.c - b.l) / range; // 0 = closed on the low, 1 = on the high
        const buyShare = closePos, sellShare = 1 - closePos;
        let kind: BubbleKind | null = null;
        if (lowerWick >= BT.wick && closePos >= 1 - BT.closeZone) kind = "sellers-absorbed";
        else if (upperWick >= BT.wick && closePos <= BT.closeZone) kind = "buyers-absorbed";
        else if (b.c >= b.o && body >= BT.body) kind = "accepted-buying";
        else if (b.c < b.o && body >= BT.body) kind = "accepted-selling";
        else if (buyShare >= BT.sideShare && sellShare >= BT.sideShare) kind = "contested";
        if (kind) {
          const bias = kind === "sellers-absorbed" || kind === "accepted-buying" ? "bullish" : kind === "contested" ? "neutral" : "bearish";
          out.push({ t: b.t, kind, bias, size, large: size >= BT.largeMult });
        }
      }
    }
    sum += b.v;
    if (i >= BT.window) sum -= bars[i - BT.window].v;
  }
  return out;
}

/** Volume-weighted candle tone: each bar's volume against the 89-bar average. Above 1.618x is "heavy", below 0.618x is "light", else normal. */
export function volumeTone(bars: Candle[], len = 89, hi = 1.618, lo = 0.618): ("heavy" | "light" | "normal")[] {
  const out: ("heavy" | "light" | "normal")[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].v;
    if (i >= len) sum -= bars[i - len].v;
    const n = Math.min(i + 1, len);
    const avg = sum / n;
    out.push(n < 20 || !(avg > 0) ? "normal" : bars[i].v >= hi * avg ? "heavy" : bars[i].v <= lo * avg ? "light" : "normal");
  }
  return out;
}
