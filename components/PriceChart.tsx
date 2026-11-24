"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { rsiSeries } from "@/lib/indicators";
import { chartBars, fillMarks, pricePrecision, type Candle } from "@/lib/pool";

/* Candlestick + volume chart (TradingView's open-source Lightweight Charts) over the
   pool's own OHLCV. Fresh candles arrive by polling; when the window is unchanged the
   newest bars are updated in place, so a live update never resets your zoom or scroll. */

const capLabel = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

const css = (name: string, fallback: string) => {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
};

interface Props {
  candles: Candle[];
  barSecs: number;
  /** trade markers to draw on the chart; none today, kept for real fills once agents trade from the UI */
  fills?: { t: number; side: "buy" | "sell"; price: number }[];
  /** changes when the token or interval changes, so the view is refitted */
  resetKey: string;
  /** values are market cap (USD), not price: format the right axis as $1.2M */
  cap?: boolean;
  /** draw RSI(14) in a pane under the price */
  rsi?: boolean;
  /** the pool's live price, ticked between candle refreshes so the last bar moves */
  livePrice?: number;
}

export function PriceChart({ candles, barSecs, fills = [], resetKey, cap, rsi: showRsi, livePrice }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const price = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const marks = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const rsiLine = useRef<ISeriesApi<"Line"> | null>(null);
  const lastBar = useRef<Candle | null>(null);
  const shown = useRef<{ key: string; firstT: number; lastT: number; n: number } | null>(null);

  // create once
  useEffect(() => {
    if (!box.current) return;
    const lock = window.matchMedia("(max-width:640px)").matches; // on a phone the chart is look-only: no pinch, drag or wheel, so the page never fights it
    const text = css("--text-tertiary", "#6b7a92");
    const grid = css("--border-subtle", "#e6e2da");
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: text, fontFamily: "var(--font-mono), monospace", fontSize: 11 },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: grid, scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: { borderColor: grid, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: 1 },
      handleScale: lock ? false : undefined,
      handleScroll: lock ? false : undefined,
      localization: { locale: "en-US" },
    });
    const up = css("--pos", "#178054");
    const down = css("--neg", "#be3030");
    const p = c.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
    const v = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    chart.current = c;
    price.current = p;
    volume.current = v;
    marks.current = createSeriesMarkers(p, []);
    return () => {
      c.remove();
      chart.current = price.current = volume.current = rsiLine.current = null;
      lastBar.current = null;
      marks.current = null;
      shown.current = null;
    };
  }, []);

  // data
  useEffect(() => {
    const p = price.current, v = volume.current, c = chart.current;
    if (!p || !v || !c) return;
    const bars = chartBars(candles);
    if (bars.length === 0) return;

    const last = bars[bars.length - 1];
    const prec = pricePrecision(last.c);
    p.applyOptions({
      priceFormat: cap
        ? { type: "custom", minMove: 1, formatter: (n: number) => capLabel(n) }
        : { type: "price", precision: prec, minMove: 1 / 10 ** prec },
    });

    const up = css("--pos", "#178054");
    const down = css("--neg", "#be3030");
    const toC = (b: Candle) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c });
    const toV = (b: Candle) => ({ time: b.t as UTCTimestamp, value: b.v, color: (b.c >= b.o ? up : down) + "88" });

    const prev = shown.current;
    const sameWindow = prev && prev.key === resetKey && prev.firstT === bars[0].t && bars.length >= prev.n && bars[bars.length - 1].t >= prev.lastT;
    if (sameWindow) {
      // live update: only touch bars from the previously newest one onward
      for (const b of bars) {
        if (b.t >= prev.lastT) {
          p.update(toC(b));
          v.update(toV(b));
        }
      }
    } else {
      p.setData(bars.map(toC));
      v.setData(bars.map(toV));
      c.timeScale().fitContent();
    }
    shown.current = { key: resetKey, firstT: bars[0].t, lastT: last.t, n: bars.length };
    lastBar.current = last;
    // the RSI pane is added only after the price series has data, and refreshed with every data update
    if (showRsi && !rsiLine.current) {
      const l = c.addSeries(LineSeries, { color: css("--blue-500", "#3b73c9"), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: "price", precision: 0, minMove: 1 } }, 1);
      l.createPriceLine({ price: 70, color: css("--neg", "#be3030"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      l.createPriceLine({ price: 30, color: css("--pos", "#178054"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
      rsiLine.current = l;
      c.panes()[1]?.setHeight(window.matchMedia("(max-width:640px)").matches ? 56 : 90);
    } else if (!showRsi && rsiLine.current) {
      c.removeSeries(rsiLine.current);
      rsiLine.current = null;
    }
    rsiLine.current?.setData(rsiSeries(bars).map((x) => ({ time: x.t as UTCTimestamp, value: x.v })));
  }, [candles, resetKey, cap, showRsi]);

  // live tick: move the newest bar with the pool's price between refreshes
  useEffect(() => {
    const p = price.current, lb = lastBar.current;
    if (!p || !lb || !livePrice || !(livePrice > 0)) return;
    const nb = { ...lb, c: livePrice, h: Math.max(lb.h, livePrice), l: Math.min(lb.l, livePrice) };
    p.update({ time: nb.t as UTCTimestamp, open: nb.o, high: nb.h, low: nb.l, close: nb.c });
    lastBar.current = nb;
  }, [livePrice, cap]);

  // trade markers, snapped to their bars
  useEffect(() => {
    const m = marks.current;
    if (!m) return;
    const bars = chartBars(candles);
    m.setMarkers(
      fillMarks(bars, fills, barSecs)
        .sort((a, b) => a.time - b.time)
        .map((f) => ({
          time: f.time as UTCTimestamp,
          position: f.side === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
          shape: f.side === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
          color: f.side === "buy" ? css("--pos", "#178054") : css("--neg", "#be3030"),
          text: f.side === "buy" ? "Buy" : "Sell",
        }))
    );
  }, [candles, fills, barSecs]);

  return <div ref={box} className="pricechart" role="img" aria-label="Price chart" />;
}
