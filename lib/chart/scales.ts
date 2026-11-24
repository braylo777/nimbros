/* The maths of the NimBros chart engine: no drawing, no DOM, so every rule here is tested. A "view" is the stretch of bars on screen, as
   fractional bar positions (from 3.5 to 120.2 means half of bar 3 up to a fifth of bar 120). */

export interface View { from: number; to: number }
export const MIN_BARS = 12;
export const PAD_BARS = 6; // room to scroll past either end

/** Round ticks a reader expects (1, 2, 5, 10 × a power of ten) covering [min, max], at most about `target` of them. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return Number.isFinite(min) ? [min] : [];
  const raw = (max - min) / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

export const xOf = (i: number, v: View, w: number) => ((i - v.from) / (v.to - v.from)) * w;
export const indexAt = (x: number, v: View, w: number) => v.from + (x / w) * (v.to - v.from);

/** The bar nearest to a pixel, or null when the pixel is outside the data. */
export function nearestBar(x: number, v: View, w: number, n: number): number | null {
  const i = Math.round(indexAt(x, v, w)); // bars are centred on their index
  return i >= 0 && i < n ? i : null;
}

/** The view that shows the newest `count` bars. */
export const latestView = (n: number, count = 120): View => ({ from: Math.max(-PAD_BARS, n - count), to: n + 2 });

function clamp(v: View, n: number): View {
  const span = v.to - v.from;
  let from = v.from, to = v.to;
  if (from < -PAD_BARS) { from = -PAD_BARS; to = from + span; }
  if (to > n + PAD_BARS) { to = n + PAD_BARS; from = to - span; }
  return { from, to };
}

/** Zoom by `factor` (below 1 zooms in) keeping the bar under `anchor` where it is on screen. */
export function zoomAround(v: View, factor: number, anchor: number, n: number): View {
  const span = Math.min(Math.max(MIN_BARS, (v.to - v.from) * factor), n + PAD_BARS * 2);
  const k = (anchor - v.from) / (v.to - v.from);
  return clamp({ from: anchor - k * span, to: anchor + (1 - k) * span }, n);
}

/** Drag the chart by a number of pixels (positive = towards older bars). */
export function panBy(v: View, dxPx: number, w: number, n: number): View {
  const d = (dxPx / w) * (v.to - v.from);
  return clamp({ from: v.from - d, to: v.to - d }, n);
}

/** Price range for the bars in view, with breathing room. Flat data still gets a visible range. */
export function priceRange(bars: { h: number; l: number }[], v: View, pad = 0.08): { lo: number; hi: number } | null {
  const a = Math.max(0, Math.floor(v.from)), b = Math.min(bars.length - 1, Math.ceil(v.to));
  if (b < a) return null;
  let lo = Infinity, hi = -Infinity;
  for (let i = a; i <= b; i++) { lo = Math.min(lo, bars[i].l); hi = Math.max(hi, bars[i].h); }
  if (!Number.isFinite(lo)) return null;
  if (hi === lo) { const m = Math.abs(hi) * 0.01 || 1; return { lo: lo - m, hi: hi + m }; }
  const p = (hi - lo) * pad;
  return { lo: lo - p, hi: hi + p };
}

export const yOf = (price: number, lo: number, hi: number, top: number, h: number) => top + (1 - (price - lo) / (hi - lo)) * h;
export const priceAt = (y: number, lo: number, hi: number, top: number, h: number) => lo + (1 - (y - top) / h) * (hi - lo);

const UNITS: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
/** $1.2M / $340K / $0.000041: the axis and bubble format for market cap (or price when there is no cap). */
export function money(n: number, cap = true): string {
  const a = Math.abs(n);
  if (cap) {
    for (const [d, u] of UNITS) if (a >= d) return `$${(n / d).toFixed(a / d < 10 ? 2 : a / d < 100 ? 1 : 0)}${u}`;
    return `$${n.toFixed(a < 10 ? 2 : 0)}`;
  }
  if (a >= 1) return `$${n.toFixed(2)}`;
  const digits = Math.min(12, Math.max(2, Math.ceil(-Math.log10(a || 1)) + 3));
  return `$${n.toFixed(digits)}`;
}

/** Axis and bubble time: clock time within a day, date across days. */
export function timeLabel(t: number, secs: number, full = false): string {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const clock = secs < 60 ? `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` : `${p(d.getHours())}:${p(d.getMinutes())}`;
  const day = `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
  if (secs >= 86_400) return full ? `${day}, ${d.getFullYear()}` : day;
  return full ? `${day}, ${clock}` : clock;
}
