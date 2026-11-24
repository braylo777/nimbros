"use client";

import { useMemo } from "react";
import { useApp } from "./AppState";
import { Avatar } from "./Chrome";
import { marketStats, topMovers1h } from "@/lib/marketStats";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/store";
import type { Token } from "@/lib/types";

/* The top of the homepage: what is being tracked right now, and the biggest movers. */

export function HomeHero({ rows: allRows }: { rows: Token[] }) {
  const { showView, setCurToken } = useApp();
  /* The headline numbers describe what NimBros is tracking right now: every coin in the live Solana feeds, across all launchpads. Agent activity is NimBros's own. */
  const rows = allRows;
  const stats = useMemo(() => marketStats(rows), [rows]);
  const dexVol = useMemo(() => rows.reduce((s, t) => s + (t.vol24h > 0 ? t.vol24h : 0), 0), [rows]); // 24h volume of the coins tracked
  // total buys + sells across every coin tracked, counting each coin once even if it appears in both lists
  const totalTxns = useMemo(() => {
    const seen = new Set<string>();
    let n = 0;
    for (const t of rows) { if (seen.has(t.contract)) continue; seen.add(t.contract); n += t.txns || 0; }
    return n;
  }, [rows]);
  const movers = useMemo(() => topMovers1h(rows, 2), [rows]);
  const open = (t: Token) => { setCurToken(t.id); showView("trade"); };

  return (
    <section className="hp-hero">
      <div className="hp-heroTop">
        <div className="hp-stats">
          <div className="hp-stat" title="Coins in the live Solana feeds NimBros tracks, from GeckoTerminal and DexScreener. Updated every few seconds."><span className="k">Total Coins Live</span><span className="v">{stats.coins > 0 ? fmtNum(stats.coins) : "—"}</span></div>
          <div className="hp-stat" title="Market-wide 24h volume of the coins tracked, from GeckoTerminal and DexScreener. Not NimBros volume."><span className="k">Volume, 24h</span><span className="v">{dexVol > 0 ? fmtUsd(dexVol) : "—"}</span></div>
          <div className="hp-stat" title="Total buys and sells across every coin tracked in the last 24h, from GeckoTerminal and DexScreener."><span className="k">Txns, 24h</span><span className="v">{totalTxns > 0 ? fmtNum(totalTxns) : "—"}</span></div>
          <div className="hp-stat">
            <span className="k">Top mover, 24h</span>
            {stats.topMover ? (
              <button className="v hp-moverlink" onClick={() => open(stats.topMover!)} title={stats.topMover.name}>
                <span>{stats.topMover.ticker}</span> <span className="pos">{fmtPct(stats.topMover.changePct)}</span>
              </button>
            ) : (
              <span className="v">—</span>
            )}
          </div>
        </div>
      </div>

      {movers.length > 0 && (
        <div className="hp-trend" aria-label="Past hour movers">
          <span className="hp-trendlabel">Past Hour Movers</span>
          <div className="hp-trendscroll">
            {movers.map((t) => (
              <button key={t.id} className="hp-chip" onClick={() => open(t)}>
                <Avatar id={t.id} src={t.logo} ticker={t.ticker} size={22} />
                <span className="hp-chipt">{t.ticker}</span>
                <span className={`hp-chipc ${(t.changePct1h ?? t.changePct) >= 0 ? "pos" : "neg"}`}>{fmtPct(t.changePct1h ?? t.changePct)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
