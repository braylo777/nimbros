"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useApp } from "./AppState";
import { QuickBuy, QuickClose } from "./QuickBuy";
import { Avatar } from "./Chrome";
import { DexTag } from "./DexLogo";
import { isPegged } from "@/lib/pegged";
import { buyPressurePct } from "@/lib/backtest";
import { nextSort, SORT_LABEL, type SortKey, type SortState } from "@/lib/sortRows";
import { fmtPct, fmtUsd } from "@/lib/store";
import { prefetchPool } from "@/lib/poolClient";
import { useHolderCount } from "@/lib/holderCount";
import { useViewers } from "@/lib/viewers";
import type { Token } from "@/lib/types";
import { quickCheck, quickCheckLabel } from "@/lib/quickCheck";
import type { FeedStatus } from "@/lib/feedStore";

/* One list of coins as a table. In a wide box it has aligned columns and sortable headings; in a narrow one (a phone, or half
   the screen in split view) each row folds into a compact card. The layout follows the box's width, not the window's. */

/* Warms the token page for a row before it's clicked: the chart's own JS chunk (once, for the whole
   session) plus that coin's candle data. Fires on hover (desktop) and touch-down (mobile, which lands
   well before the click event), so by the time the page opens there is nothing left to wait for. */
let chartChunkPreloaded = false;
function warmTokenPage(id: string) {
  if (!chartChunkPreloaded) {
    chartChunkPreloaded = true;
    void import("./PriceChart");
  }
  prefetchPool(id.replace(/^gt:/, ""), "15m");
}

const ageText = (m?: number) => (m === undefined ? "" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`);

function Head({ k, label, sort, onSort, cls }: { k: SortKey; label: string; sort: SortState; onSort: (s: SortState) => void; cls: string }) {
  const on = sort.key === k;
  return (
    <button className={`tk-h ${cls}${on ? " on" : ""}`} onClick={() => onSort(nextSort(sort, k))} aria-label={`Sort by ${SORT_LABEL[k]}`} aria-pressed={on}>
      {label}
      <span aria-hidden="true" className="tk-arrow">{on ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
    </button>
  );
}

/** True once the element has come near the screen, so holder counts load for every coin as it scrolls into view. */
function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") return; // old browser: counts simply stay off
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

const TokenRow = memo(function TokenRow({ t }: { t: Token }) {
  const [rowRef, seen] = useSeen<HTMLElement>();
  const holders = useHolderCount(t.contract, seen);
  const viewers = useViewers(t.contract);
  const { showView, setCurToken } = useApp();
  const bp = buyPressurePct(t.buys24h, t.sells24h);
  const up = t.changePct >= 0;
  const qc = quickCheck(t);
  return (
    <article
      ref={rowRef}
      className="tk"
      onClick={() => {
        setCurToken(t.id);
        showView("trade");
      }}
      onPointerEnter={() => warmTokenPage(t.id)}
      onTouchStart={() => warmTokenPage(t.id)}
    >
      <div className="tk-coin">
        <Avatar id={t.id} src={t.logo} ticker={t.ticker} size={38} badge badgeMuted={!isPegged(t)} />
        <div className="tk-name">
          <span className="tk-title">{t.name}</span>
          <span className="tk-sub">
            <span className="mono">${t.ticker}</span>
            <span className={`qc qc-${qc.level}`} title={`Quick check: ${qc.why.join("; ")}`}>{quickCheckLabel(qc.level)}</span>
            {t.dex && <DexTag id={t.dex} size={13} />}
            {t.ageMin !== undefined && <span className="tk-age">{ageText(t.ageMin)}</span>}
            <span className="tk-age" title="People on NimBros looking at this coin right now">{viewers} {viewers === 1 ? "viewer" : "viewers"}</span>
            {typeof holders === "string" && <span className="tk-age" title="Wallets holding this coin, read from the chain">{holders} {holders === "1" ? "holder" : "holders"}</span>}
          </span>
        </div>
      </div>
      <span className={`tk-chg chgpill ${up ? "pos" : "neg"}`}>{fmtPct(t.changePct)}</span>
      <div className="tk-meta">
        <span className="tk-price mono" data-label="MC">{t.marketCap > 0 ? fmtUsd(t.marketCap) : "—"}</span>
        <span className="tk-liq mono" data-label="Liq">{fmtUsd(t.liquidity)}</span>
        <span className="tk-vol mono" data-label="Vol">{fmtUsd(t.vol24h)}</span>
        <span className="tk-bp" data-label="Buys" title={t.buys24h !== undefined ? `${t.buys24h} buys · ${t.sells24h} sells in 24h` : undefined}>
          {bp === null ? (
            <span className="mono tk-none">—</span>
          ) : (
            <>
              <span className="bpbar"><i style={{ width: `${bp}%` }} /></span>
              <span className="mono">{bp.toFixed(0)}%</span>
            </>
          )}
        </span>
      </div>
      <div className="tk-act">
        <QuickBuy tok={t} />
        <QuickClose tok={t} />
      </div>
    </article>
  );
}, (a, b) => a.t.id === b.t.id && a.t.price === b.t.price && a.t.changePct === b.t.changePct && a.t.liquidity === b.t.liquidity && a.t.vol24h === b.t.vol24h && a.t.buys24h === b.t.buys24h && a.t.sells24h === b.t.sells24h && a.t.ageMin === b.t.ageMin);

export function TokenList({
  rows, action, sort, onSort, status, hiddenByFilters, onClear,
}: {
  rows: Token[];
  action: string;
  sort: SortState;
  onSort: (s: SortState) => void;
  status: FeedStatus;
  hiddenByFilters: boolean;
  onClear: () => void;
}) {
  return (
    <section className="tk-card" aria-label={action}>
      <div className="tk-list">
        <div className="tk-head" role="row">
          <Head k="name" label="Coin" sort={sort} onSort={onSort} cls="h-coin" />
          <Head k="chg" label="24h" sort={sort} onSort={onSort} cls="h-chg" />
          <Head k="mcap" label="Market Cap" sort={sort} onSort={onSort} cls="h-price" />
          <Head k="liq" label="Liquidity" sort={sort} onSort={onSort} cls="h-liq" />
          <Head k="vol" label="Volume" sort={sort} onSort={onSort} cls="h-vol" />
          <Head k="bp" label="Buys" sort={sort} onSort={onSort} cls="h-bp" />
          <span className="tk-h h-act" aria-hidden="true" />
        </div>

        {rows.length > 0 && status === "error" && <div className="tk-offline">Offline. Showing the last data we had. Retrying…</div>}
        {rows.length > 0 ? (
          rows.map((t) => <TokenRow key={t.id} t={t} />)
        ) : hiddenByFilters ? (
          <div className="tk-empty">
            <p>No coins here match your filters.</p>
            <button className="btn ghost sm" onClick={onClear}>Clear filters</button>
          </div>
        ) : status === "loading" ? (
          <div aria-busy="true" aria-label="Loading live data">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="skelrow">
                <span className="skelcircle" />
                <span className="skelbars"><span /><span /></span>
              </div>
            ))}
          </div>
        ) : (
          <div className="tk-empty">
            <p>{status === "error" ? "Couldn’t load coins. Retrying." : "No coins yet."}</p>
          </div>
        )}
      </div>
    </section>
  );
}
