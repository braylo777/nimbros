"use client";

import type { Token } from "@/lib/types";
import { findOriginals, findVamps } from "@/lib/vamp";
import { fmtUsd } from "@/lib/store";
import { useEffect, useState } from "react";
import type { HoldersState } from "./HoldersCard";

export type SellState = { status: "loading" } | { status: "ok"; verdict: "ok" | "taxed" | "blocked" | "unchecked"; note?: string; reason?: string; receivedPct?: number };

/** Dry-run sale by a real holder (see /api/sellcheck). */
export function useSellCheck(coin: string): SellState {
  const [s, setS] = useState<{ coin: string; v: SellState } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/sellcheck?coin=${encodeURIComponent(coin)}`)
      .then((r) => r.json() as Promise<{ verdict?: string; note?: string; reason?: string; receivedPct?: number }>)
      .then((j) => alive && setS({ coin, v: { status: "ok", verdict: (["ok", "taxed", "blocked"].includes(j.verdict ?? "") ? j.verdict : "unchecked") as "ok", note: j.note, reason: j.reason, receivedPct: j.receivedPct } }))
      .catch(() => alive && setS({ coin, v: { status: "ok", verdict: "unchecked", reason: "The check couldn't run." } }));
    return () => {
      alive = false;
    };
  }, [coin]);
  return s && s.coin === coin ? s.v : { status: "loading" };
}

export type SniperState = { status: "loading" } | { status: "ok"; verdict: "ok" | "unchecked"; wallets?: number; stillHolding?: number; heldPct?: number; reason?: string };

/** First wallets into the pool and how much they still hold (see /api/snipers). */
export function useSnipers(pool: string, coin: string): SniperState {
  const [s, setS] = useState<{ k: string; v: SniperState } | null>(null);
  const k = `${pool}|${coin}`;
  useEffect(() => {
    let alive = true;
    fetch(`/api/snipers?pool=${encodeURIComponent(pool)}&coin=${encodeURIComponent(coin)}`)
      .then((r) => r.json() as Promise<{ verdict?: string; wallets?: number; stillHolding?: number; heldPct?: number; reason?: string }>)
      .then((j) => alive && setS({ k, v: { status: "ok", verdict: j.verdict === "ok" ? "ok" : "unchecked", wallets: j.wallets, stillHolding: j.stillHolding, heldPct: j.heldPct, reason: j.reason } }))
      .catch(() => alive && setS({ k, v: { status: "ok", verdict: "unchecked", reason: "The check couldn't run." } }));
    return () => {
      alive = false;
    };
  }, [k, pool, coin]);
  return s && s.k === k ? s.v : { status: "loading" };
}

/* Risk that comes from who holds the coin and who copied it. All of it is read from the chain or the live feeds;
   anything we can't read is shown as unchecked, never as fine. */

type Lvl = "good" | "warn" | "" ;
const cls = (l: Lvl) => (l === "good" ? "pos" : l === "warn" ? "neg" : "");

export interface RiskProps { tok: Token; holders: HoldersState; creator?: string; all: Token[]; sell: SellState; snipers: SniperState }
export interface RiskRow { k: string; v: string; l: Lvl; note?: string }

export function riskRows({ tok, holders, creator, all, sell, snipers }: RiskProps): RiskRow[] {
  const vamps = findVamps(tok, all);
  const originals = findOriginals(tok, all);
  const rows: RiskRow[] = [];

  if (holders.status === "ok") {
    const d = holders.data;
    const dev = creator ? d.rows.find((r) => r.address.toLowerCase() === creator.toLowerCase()) : undefined;
    rows.push({
      k: "Creator holds",
      v: !creator ? "creator unknown" : dev ? `${dev.pct.toFixed(1)}%` : "outside top 10",
      l: !creator ? "" : dev ? (dev.pct >= 10 ? "warn" : "good") : "good",
      note: "Share of supply still in the wallet that published the coin.",
    });
    rows.push({ k: "Top 10 wallets", v: `${d.top10Pct.toFixed(1)}%`, l: d.top10Pct >= 50 ? "warn" : "good", note: "Concentration among the ten biggest wallet holders." });
    rows.push({
      k: "Linked wallets",
      v: d.linkedGroups.length ? `${d.linkedGroups.reduce((s, g) => s + g.wallets, 0)} wallets, ${d.linkedGroups.reduce((s, g) => s + g.pct, 0).toFixed(1)}%` : "none found",
      l: d.linkedGroups.length ? "warn" : "good",
      note: "Top wallets first funded by the same wallet.",
    });
    rows.push({ k: "Holders", v: `${d.holders.toLocaleString("en-US")}${d.partial ? "+" : ""}`, l: d.holders < 50 ? "warn" : "", note: "Wallets directly holding the coin." });
  } else {
    rows.push({ k: "Holders", v: holders.status === "loading" ? "reading…" : "unchecked", l: "" });
  }

  rows.push(
    snipers.status === "loading"
      ? { k: "Early buyers", v: "reading…", l: "" }
      : snipers.verdict === "ok"
        ? { k: "Early buyers", v: `${snipers.stillHolding}/${snipers.wallets} still hold ${snipers.heldPct?.toFixed(1)}%`, l: (snipers.heldPct ?? 0) >= 15 ? "warn" : "good", note: "The first wallets to trade this pool (its creator excluded) and how much of the supply they hold now." }
        : { k: "Early buyers", v: "unchecked", l: "", note: snipers.reason },
  );
  rows.push(
    sell.status === "loading"
      ? { k: "Sell test", v: "testing…", l: "" }
      : sell.verdict === "ok"
        ? { k: "Sell test", v: `passed${sell.receivedPct ? `, ${sell.receivedPct.toFixed(0)}% payout` : ""}`, l: "good", note: sell.note }
        : sell.verdict === "unchecked"
          ? { k: "Sell test", v: "unchecked", l: "", note: sell.reason }
          : { k: "Sell test", v: sell.verdict === "blocked" ? "FAILED: sells revert" : "FAILED: sale skimmed", l: "warn", note: sell.note },
  );

  const vampVol = vamps.reduce((s, v) => s + v.vol24h, 0);
  rows.push({
    k: "Copycat coins",
    v: vamps.length ? `${vamps.length} newer, ${fmtUsd(vampVol)} 24h vol` : "none in live lists",
    l: vamps.length ? "warn" : "good",
    note: "Newer coins with the same ticker or name, trying to pull volume away.",
  });
  if (originals.length) rows.push({ k: "This may be a copy", v: `${originals.length} older, deeper coin${originals.length > 1 ? "s" : ""}`, l: "warn", note: originals.map((o) => `${o.ticker} (${fmtUsd(o.liquidity)} liquidity)`).join(", ") });

  return rows;
}

export function HolderRisk(p: RiskProps) {
  const rows = riskRows(p);
  return (
    <div className="panel">
      <div className="paneltitle">Holder &amp; copycat risk</div>
      {rows.map((r) => (
        <div className="trustrow" key={r.k} title={r.note}>
          <span className="k">{r.k}</span>
          <span className={`v mono ${cls(r.l)}`}>{r.v}</span>
        </div>
      ))}
      <p className="hint" style={{ marginTop: 8 }}>
        Sell test: we dry-run a real holder&apos;s sale through the same router you would use. Nothing is sent. A pass is strong evidence, not a guarantee.
      </p>
    </div>
  );
}

/** The same checks as short coloured chips, for the compact view. */
export function RiskChips(p: RiskProps & { only?: string[] }) {
  return (
    <div className="ix-flags">
      {riskRows(p).filter((r) => !p.only || p.only.includes(r.k)).map((r) => (
        <span key={r.k} className={`ix-flag ${r.l}`} title={r.note}>
          {r.k} <b className="mono">{r.v}</b>
        </span>
      ))}
    </div>
  );
}
