"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bigTrades, rsiSeries, smaSeries } from "@/lib/indicators";
import { chartBars, type Candle } from "@/lib/pool";
import { volumeProfile } from "@/lib/volumeProfile";
import { indexAt, latestView, money, nearestBar, niceTicks, panBy, priceRange, timeLabel, xOf, yOf, zoomAround, type View } from "@/lib/chart/scales";

/* The NimBros chart engine (beta): one canvas, our own scales and gestures, no third-party charting library.

   Opens as one clean line in the colour of the move (like a brokerage app); a tap on the corner switches to candles. Move a finger or the
   pointer across it to scrub: the value and time follow the line. Drag to pan, pinch or ctrl+scroll to zoom, double-tap to reset. The
   structure layer (volume profile, value area with POC/VAH/VAL, big-trade dots, RSI with its average and overbought/oversold shading)
   is drawn in the same coordinates as the price, so nothing can drift out of line with it. */

interface Props {
  candles: Candle[];
  barSecs: number;
  /** changes when the coin or interval changes, so the view resets */
  resetKey: string;
  /** values are market cap (dollars), not price */
  cap?: boolean;
  rsi?: boolean;
  /** the pool's live price, ticked between candle refreshes so the last bar moves */
  livePrice?: number;
  /** the viewer's own fills, in the same units as the chart */
  marks?: { t: number; side: "buy" | "sell"; price: number }[];
  /** the viewer's average entry, in the same units as the chart */
  entry?: number;
}

const tok = (name: string, fallback: string) => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
};
const AXIS_W = 64, TIME_H = 22, TOP = 34;

export function NativeChart({ candles, barSecs, resetKey, cap = true, rsi: showRsi = true, livePrice, marks, entry }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const mode = "candles" as "line" | "candles"; // candles only: the line style was removed
  const view = useRef<View>({ from: 0, to: 120 });
  const key = useRef("");
  const nPrev = useRef(0);
  const scrub = useRef<number | null>(null);
  const raf = useRef(0);
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const last = useRef<{ dist: number; mid: number } | null>(null);
  const drag = useRef<{ x: number } | null>(null);

  const bars = useMemo(() => {
    const b = chartBars(candles);
    if (livePrice && livePrice > 0 && b.length) {
      const l = b[b.length - 1];
      return [...b.slice(0, -1), { ...l, c: livePrice, h: Math.max(l.h, livePrice), l: Math.min(l.l, livePrice) }];
    }
    return b;
  }, [candles, livePrice]);
  const rsiPts = useMemo(() => (showRsi ? rsiSeries(bars) : []), [bars, showRsi]);
  const rsiAvg = useMemo(() => smaSeries(rsiPts, 14), [rsiPts]);
  const bubbles = useMemo(() => bigTrades(bars), [bars]);
  const barsRef = useRef(bars);
  const modeRef = useRef(mode);
  const tradeRef = useRef({ marks, entry });
  useEffect(() => { tradeRef.current = { marks, entry }; }, [marks, entry]);
  // kept current from effects (declared before the ones that draw, so a draw always sees the latest)
  useEffect(() => { barsRef.current = bars; }, [bars]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const draw = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = cv.current, host = wrap.current;
      const b = barsRef.current;
      if (!el || !host) return;
      const W = host.clientWidth, H = host.clientHeight, dpr = window.devicePixelRatio || 1;
      if (el.width !== Math.round(W * dpr) || el.height !== Math.round(H * dpr)) { el.width = Math.round(W * dpr); el.height = Math.round(H * dpr); }
      const g = el.getContext("2d");
      if (!g || W < 10 || H < 10) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      if (b.length < 2) return;

      // theme
      const dim = tok("--text-tertiary", "#7a879c"), grid = tok("--border-subtle", "#e6e2da");
      const pos = tok("--pos", "#178054"), neg = tok("--neg", "#be3030"), brand = tok("--blue-600", "#306ac0");
      g.font = "11px var(--font-mono), monospace";

      // layout
      const rsiH = showRsi ? (W < 520 ? 72 : 112) : 0;
      const plotW = W - AXIS_W;
      const mainH = H - TOP - TIME_H - (rsiH ? rsiH + 10 : 0);
      const v = view.current;
      const r = priceRange(b, v);
      if (!r || mainH < 40) return;
      const { lo, hi } = r;
      const X = (i: number) => xOf(i + 0.5, v, plotW);
      const Y = (p: number) => yOf(p, lo, hi, TOP, mainH);
      const barPx = plotW / (v.to - v.from);
      const a = Math.max(0, Math.floor(v.from)), z = Math.min(b.length - 1, Math.ceil(v.to));
      const up = b[z].c >= b[a].o;
      const tone = up ? pos : neg;

      // grid + price axis
      g.textBaseline = "middle";
      g.textAlign = "left";
      for (const t of niceTicks(lo, hi, 5)) {
        const y = Y(t);
        if (y < TOP || y > TOP + mainH) continue;
        g.strokeStyle = grid; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(plotW, y + 0.5); g.stroke();
        g.fillStyle = dim; g.fillText(money(t, cap), plotW + 8, y);
      }

      // volume profile, left: soft blue inside the value area, grey outside, brand blue at the point of control
      const slice = b.slice(a, z + 1);
      const rows = Math.max(14, Math.min(60, Math.round(mainH / 7)));
      const prof = volumeProfile(slice, rows, lo, hi);
      const maxW = Math.min(140, plotW * 0.24);
      if (prof) {
        prof.rows.forEach((row, i) => {
          if (row.total <= 0) return;
          const y1 = Y(row.hi), y2 = Y(row.lo);
          const inArea = i >= prof.area[0] && i <= prof.area[1];
          g.fillStyle = i === prof.poc ? brand : inArea ? "rgba(48,106,192,0.34)" : "rgba(122,134,156,0.2)";
          g.beginPath();
          const w = Math.max(2, (row.total / prof.max) * maxW), h = Math.max(1, y2 - y1 - 1.5);
          if (g.roundRect) g.roundRect(0, y1, w, h, Math.min(3, h / 2)); else g.rect(0, y1, w, h);
          g.fill();
        });
        // value-area band and lines
        const vah = prof.rows[prof.area[1]].hi, val = prof.rows[prof.area[0]].lo;
        const poc = (prof.rows[prof.poc].lo + prof.rows[prof.poc].hi) / 2;
        g.fillStyle = "rgba(48,106,192,0.055)";
        g.fillRect(maxW + 6, Y(vah), plotW - maxW - 6, Y(val) - Y(vah));
        g.strokeStyle = "rgba(48,106,192,0.22)"; g.lineWidth = 1;
        for (const p of [vah, val]) { g.beginPath(); g.moveTo(maxW + 6, Y(p) + 0.5); g.lineTo(plotW, Y(p) + 0.5); g.stroke(); }
        g.strokeStyle = "rgba(48,106,192,0.7)"; g.lineWidth = 1.25;
        g.beginPath(); g.moveTo(maxW + 6, Y(poc) + 0.5); g.lineTo(plotW, Y(poc) + 0.5); g.stroke();
        g.textAlign = "right";
        g.fillStyle = "rgba(90,104,128,0.95)";
        g.fillText(W < 520 ? "VAH" : `VAH ${money(vah, cap)}`, plotW - 6, Y(vah) - 8);
        g.fillText(W < 520 ? "VAL" : `VAL ${money(val, cap)}`, plotW - 6, Y(val) + 10);
        g.fillStyle = brand;
        g.fillText(W < 520 ? "POC" : `POC ${money(poc, cap)}`, plotW - 6, Y(poc) - 8);
        g.textAlign = "left";
      }

      // price series
      g.save();
      g.beginPath(); g.rect(0, TOP - 4, plotW, mainH + 8); g.clip();
      if (modeRef.current === "line") {
        const grad = g.createLinearGradient(0, TOP, 0, TOP + mainH);
        grad.addColorStop(0, tone + "38"); grad.addColorStop(1, tone + "00");
        g.beginPath();
        for (let i = a; i <= z; i++) { const x = X(i), y = Y(b[i].c); if (i === a) g.moveTo(x, y); else g.lineTo(x, y); }
        g.strokeStyle = tone; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
        g.lineTo(X(z), TOP + mainH); g.lineTo(X(a), TOP + mainH); g.closePath(); g.fillStyle = grad; g.fill();
      } else {
        const bw = Math.max(1, Math.min(14, barPx * 0.7));
        for (let i = a; i <= z; i++) {
          const k = b[i], x = X(i), c = k.c >= k.o ? pos : neg;
          g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 1;
          g.beginPath(); g.moveTo(x + 0.5, Y(k.h)); g.lineTo(x + 0.5, Y(k.l)); g.stroke();
          const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c));
          g.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
        }
      }
      // big-trade dots
      const at = new Map(b.map((k, i) => [k.t, i]));
      for (const bt of bubbles) {
        const i = at.get(bt.t);
        if (i === undefined || i < a || i > z) continue;
        const above = bt.bias === "bearish";
        g.fillStyle = (bt.bias === "bullish" ? pos : bt.bias === "bearish" ? neg : dim) + (bt.large ? "" : "aa");
        g.beginPath(); g.arc(X(i), above ? Y(b[i].h) - 8 : Y(b[i].l) + 8, bt.large ? 4 : 2.6, 0, Math.PI * 2); g.fill();
      }
      // your trades: an arrow on the bar of each fill, and your average entry as a line
      const { marks: tm, entry: ep } = tradeRef.current;
      for (const m of tm ?? []) {
        let i = -1;
        for (let k = b.length - 1; k >= 0; k--) if (b[k].t <= m.t) { i = k; break; }
        if (i < a || i > z) continue;
        const buy = m.side === "buy", x = X(i), y = buy ? Y(b[i].l) + 16 : Y(b[i].h) - 16;
        g.fillStyle = buy ? pos : neg;
        g.beginPath();
        if (buy) { g.moveTo(x, y - 7); g.lineTo(x - 6, y + 4); g.lineTo(x + 6, y + 4); } else { g.moveTo(x, y + 7); g.lineTo(x - 6, y - 4); g.lineTo(x + 6, y - 4); }
        g.closePath(); g.fill();
      }
      if (ep && ep > 0) {
        const ey = Y(ep);
        if (ey >= TOP && ey <= TOP + mainH) {
          g.strokeStyle = brand; g.lineWidth = 1.25; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(0, ey + 0.5); g.lineTo(plotW, ey + 0.5); g.stroke(); g.setLineDash([]);
          const pct = ((b[b.length - 1].c - ep) / ep) * 100;
          const text = `Your entry ${money(ep, cap)}  ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
          g.font = "600 10px var(--font-mono), monospace";
          const tw = g.measureText(text).width;
          g.fillStyle = pct >= 0 ? pos : neg;
          g.beginPath(); if (g.roundRect) g.roundRect(plotW - tw - 22, ey - 9, tw + 12, 18, 9); else g.rect(plotW - tw - 22, ey - 9, tw + 12, 18); g.fill();
          g.fillStyle = "#fff"; g.textAlign = "left"; g.fillText(text, plotW - tw - 16, ey + 0.5);
          g.font = "11px var(--font-mono), monospace";
        }
      }
      g.restore();

      // last price line + tag
      const lastP = b[b.length - 1].c, ly = Y(lastP);
      if (ly >= TOP && ly <= TOP + mainH) {
        g.setLineDash([3, 4]); g.strokeStyle = tone; g.globalAlpha = 0.7; g.beginPath(); g.moveTo(0, ly + 0.5); g.lineTo(plotW, ly + 0.5); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
        g.fillStyle = tone; g.beginPath(); if (g.roundRect) g.roundRect(plotW + 2, ly - 9, AXIS_W - 4, 18, 5); else g.rect(plotW + 2, ly - 9, AXIS_W - 4, 18); g.fill();
        g.fillStyle = "#fff"; g.fillText(money(lastP, cap), plotW + 7, ly);
      }

      // time axis
      g.fillStyle = dim; g.textAlign = "center";
      const stops = Math.max(2, Math.floor(plotW / 96));
      for (let s = 0; s <= stops; s++) {
        const i = Math.round(v.from + ((v.to - v.from) * (s + 0.5)) / (stops + 1));
        if (i < 0 || i >= b.length) continue;
        g.fillText(timeLabel(b[i].t, barSecs), X(i), H - TIME_H / 2 + 2);
      }
      g.textAlign = "left";

      // RSI pane: purple line, yellow average, green above 70 and red below 30 filled toward the level
      if (rsiH) {
        const top = TOP + mainH + 10;
        const Yr = (p: number) => top + (1 - p / 100) * rsiH;
        g.fillStyle = "rgba(48,106,192,0.06)"; g.fillRect(0, Yr(70), plotW, Yr(30) - Yr(70));
        g.strokeStyle = dim; g.globalAlpha = 0.5; g.setLineDash([4, 4]);
        for (const l of [70, 50, 30]) { g.beginPath(); g.moveTo(0, Yr(l) + 0.5); g.lineTo(plotW, Yr(l) + 0.5); g.stroke(); }
        g.setLineDash([]); g.globalAlpha = 1;
        const pts = rsiPts.map((p) => ({ i: at.get(p.t) ?? -1, v: p.v })).filter((p) => p.i >= a - 1 && p.i <= z + 1);
        const fillBand = (level: number, color: string, above: boolean) => {
          const grd = g.createLinearGradient(0, above ? Yr(100) : Yr(level), 0, above ? Yr(level) : Yr(0));
          grd.addColorStop(above ? 0 : 1, color + "99"); grd.addColorStop(above ? 1 : 0, color + "0d");
          g.fillStyle = grd; g.beginPath(); let open = false;
          pts.forEach((p, k) => {
            const inside = above ? p.v > level : p.v < level;
            const x = X(p.i), y = Yr(inside ? p.v : level);
            if (inside && !open) { g.moveTo(x, Yr(level)); open = true; }
            if (open) g.lineTo(x, y);
            if (open && (!inside || k === pts.length - 1)) { g.lineTo(x, Yr(level)); g.closePath(); open = false; }
          });
          g.fill();
        };
        g.save(); g.beginPath(); g.rect(0, top, plotW, rsiH); g.clip();
        fillBand(70, pos, true); fillBand(30, neg, false);
        const line = (series: { i: number; v: number }[], color: string, w: number) => {
          g.strokeStyle = color; g.lineWidth = w; g.beginPath();
          series.forEach((p, k) => { const x = X(p.i), y = Yr(p.v); if (k === 0) g.moveTo(x, y); else g.lineTo(x, y); }); g.stroke();
        };
        line(rsiAvg.map((p) => ({ i: at.get(p.t) ?? -1, v: p.v })).filter((p) => p.i >= a - 1 && p.i <= z + 1), "#e0b100", 1);
        line(pts, brand, 1.75);
        g.restore();
        g.fillStyle = dim; g.fillText("70", plotW + 8, Yr(70)); g.fillText("50", plotW + 8, Yr(50)); g.fillText("30", plotW + 8, Yr(30));
        // live value, like TradingView: a purple tag on the axis at the current RSI, and the reading in the corner of the pane
        const lr = rsiPts[rsiPts.length - 1], la = rsiAvg[rsiAvg.length - 1];
        if (lr) {
          const ty = Math.max(top + 9, Math.min(top + rsiH - 9, Yr(lr.v)));
          g.fillStyle = brand; g.beginPath(); g.roundRect(plotW + 2, ty - 9, 46, 18, 4); g.fill();
          g.fillStyle = "#fff"; g.textAlign = "center"; g.fillText(lr.v.toFixed(2), plotW + 25, ty); g.textAlign = "left";
          g.fillStyle = dim; g.fillText("RSI 14", 6, top + 10);
          g.fillStyle = brand; g.fillText(lr.v.toFixed(2), 52, top + 10);
          if (la) { g.fillStyle = "#e0b100"; g.fillText(la.v.toFixed(2), 96, top + 10); }
        }
      }

      // scrub: crosshair, dot, and the reading at the top
      const s = scrub.current;
      if (s !== null && s >= 0 && s < b.length) {
        const k = b[s], x = X(s), y = Y(k.c);
        g.strokeStyle = dim; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x + 0.5, TOP - 6); g.lineTo(x + 0.5, TOP + mainH + (rsiH ? rsiH + 10 : 0)); g.stroke(); g.setLineDash([]);
        g.fillStyle = tone; g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    });
  }, [barSecs, cap, showRsi, rsiPts, rsiAvg, bubbles]);
  useEffect(() => { draw(); }, [marks, entry, draw]);

  // reset the view when the coin or interval changes; follow new bars when the newest is in view
  useEffect(() => {
    const n = bars.length;
    if (key.current !== resetKey || nPrev.current === 0) { view.current = latestView(n); key.current = resetKey; }
    else if (n > nPrev.current && view.current.to >= nPrev.current) { const d = n - nPrev.current; view.current = { from: view.current.from + d, to: view.current.to + d }; }
    nPrev.current = n;
    draw();
  }, [bars, resetKey, draw]);
  useEffect(() => { draw(); }, [mode, draw]);
  useEffect(() => {
    const host = wrap.current;
    if (!host) return;
    const ro = new ResizeObserver(draw);
    ro.observe(host);
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); };
  }, [draw]);

  const geometry = () => {
    const host = wrap.current!;
    return { plotW: host.clientWidth - AXIS_W, rect: host.getBoundingClientRect() };
  };
  const setScrubFromX = (clientX: number, haptic: boolean) => {
    const { plotW, rect } = geometry();
    const i = nearestBar(clientX - rect.left, view.current, plotW, barsRef.current.length);
    if (i !== scrub.current) {
      scrub.current = i;
      if (haptic && i !== null) { try { navigator.vibrate?.(3); } catch { /* not supported */ } }
      draw();
    }
  };
  const onDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (pointers.current.size === 1) { drag.current = { x: e.clientX }; if (e.pointerType !== "mouse") setScrubFromX(e.clientX, true); }
    if (pointers.current.size === 2) { const [p, q] = [...pointers.current.values()]; last.current = { dist: Math.abs(p.x - q.x), mid: (p.x + q.x) / 2 }; scrub.current = null; drag.current = null; }
  };
  const onMove = (e: React.PointerEvent) => {
    const { plotW, rect } = geometry();
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const n = barsRef.current.length;
    if (pointers.current.size === 2 && last.current) {
      const [p, q] = [...pointers.current.values()];
      const dist = Math.abs(p.x - q.x), mid = (p.x + q.x) / 2;
      if (last.current.dist > 8 && dist > 8) view.current = zoomAround(view.current, last.current.dist / dist, indexAt(mid - rect.left, view.current, plotW), n);
      view.current = panBy(view.current, mid - last.current.mid, plotW, n);
      last.current = { dist, mid };
      draw();
    } else if (e.pointerType === "mouse" && e.buttons === 1 && drag.current) {
      view.current = panBy(view.current, e.clientX - drag.current.x, plotW, n);
      drag.current = { x: e.clientX };
      draw();
    } else {
      setScrubFromX(e.clientX, e.pointerType !== "mouse");
    }
  };
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) last.current = null;
    if (e.pointerType !== "mouse") { scrub.current = null; draw(); } // a finger lifting ends the scrub
    drag.current = null;
  };
  const onLeave = () => { scrub.current = null; draw(); };
  /* Scroll up/down zooms the chart, like TradingView; a trackpad pinch (which arrives as ctrl+wheel) zooms too. Sideways scroll pans.
     Attached natively (non-passive) so the page itself never zooms or scrolls while the pointer is over the chart. */
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    const el = cv.current;
    const h = (e: WheelEvent) => wheelRef.current(e);
    el?.addEventListener("wheel", h, { passive: false });
    return () => el?.removeEventListener("wheel", h);
  }, []);
  useEffect(() => {
    wheelRef.current = (e: WheelEvent) => {
      e.preventDefault();
      const { plotW, rect } = geometry();
      const n = barsRef.current.length;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) { view.current = panBy(view.current, -e.deltaX, plotW, n); draw(); return; }
      const d = Math.max(-40, Math.min(40, e.deltaY)) * (e.ctrlKey ? 0.012 : 0.0035);
      view.current = zoomAround(view.current, Math.exp(d), indexAt(e.clientX - rect.left, view.current, plotW), n);
      draw();
    };
  });
  const onKey = (e: React.KeyboardEvent) => {
    const n = barsRef.current.length, { plotW } = geometry();
    if (e.key === "ArrowLeft") { scrub.current = Math.max(0, (scrub.current ?? n - 1) - 1); draw(); }
    else if (e.key === "ArrowRight") { scrub.current = Math.min(n - 1, (scrub.current ?? n - 1) + 1); draw(); }
    else if (e.key === "+" || e.key === "=") { view.current = zoomAround(view.current, 0.9, n - 1, n); draw(); }
    else if (e.key === "-") { view.current = zoomAround(view.current, 1.1, n - 1, n); draw(); }
    else if (e.key === "Home") { view.current = panBy(view.current, 1e6, plotW, n); draw(); }
    else if (e.key === "End" || e.key === "Escape") { view.current = latestView(n); scrub.current = null; draw(); }
    else return;
    e.preventDefault();
  };

  const b = bars;
  const summary = b.length > 1 ? `Chart of ${cap ? "market cap" : "price"}, now ${money(b[b.length - 1].c, cap)}, ${b[b.length - 1].c >= b[0].o ? "up" : "down"} ${Math.abs(((b[b.length - 1].c - b[0].o) / b[0].o) * 100).toFixed(1)}% over the period loaded. Use the arrow keys to move along it.` : "Chart loading";

  return (
    <div className="nchart" ref={wrap}>
      <canvas
        ref={cv}
        className="nchart-cv"
        tabIndex={0}
        role="img"
        aria-label={summary}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onLeave}
        onKeyDown={onKey}
        onDoubleClick={() => { view.current = latestView(barsRef.current.length); draw(); }}
      />
    </div>
  );
}
