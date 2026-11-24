"use client";

import { useEffect, useState } from "react";
import { shortAddr } from "@/lib/store";

export interface HolderRow { address: string; raw: string; pct: number; funder: string | null; linked: string | null }
export interface HoldersData {
  holders: number;
  partial: boolean;
  supply: string | null;
  decimals: number | null;
  heldPct: number | null;
  top10Pct: number;
  rows: HolderRow[];
  linkedGroups: { funder: string; wallets: number; pct: number }[];
}

export type HoldersState = { status: "loading" } | { status: "error" } | { status: "ok"; data: HoldersData };

/** Reads /api/holders for a coin and refreshes it every 60 s. */
export function useHolders(coin: string): HoldersState {
  const [s, setS] = useState<{ coin: string; v: HoldersState } | null>(null);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const r = await fetch(`/api/holders?coin=${encodeURIComponent(coin)}`);
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as HoldersData;
        if (alive) setS({ coin, v: { status: "ok", data } });
      } catch {
        if (alive) setS((p) => (p && p.coin === coin && p.v.status === "ok" ? p : { coin, v: { status: "error" } }));
      }
    };
    void run();
    const t = setInterval(run, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [coin]);
  return s && s.coin === coin ? s.v : { status: "loading" };
}

const scan = (a: string) => `https://solscan.io/account/${a}`;

/** Who holds the coin: a ring for how it is split, the numbers that matter, then the ten biggest wallets. */
export function HoldersCard({ state, creator, me }: { state: HoldersState; creator?: string; me?: string | null; bare?: boolean }) {
  if (state.status === "loading") return <p className="hint" style={{ margin: 0 }}>Reading holders from the chain…</p>;
  if (state.status === "error") return <p className="hint" style={{ margin: 0 }}>Couldn&apos;t read holders from the chain right now. Retrying.</p>;
  const d = state.data;
  const top3 = d.rows.slice(0, 3).reduce((s, r) => s + r.pct, 0);
  const next7 = Math.max(0, d.top10Pct - top3);
  const others = d.heldPct !== null ? Math.max(0, d.heldPct - d.top10Pct) : 0;
  const inContracts = d.heldPct !== null ? Math.max(0, 100 - d.heldPct) : 0;
  const parts = [
    { k: "Top 3", v: top3, c: "var(--blue-600)" },
    { k: "Next 7", v: next7, c: "var(--blue-500)" },
    { k: "Other wallets", v: others, c: "#9db8e0" },
    { k: "Pools & contracts", v: inContracts, c: "var(--surface-3)" },
  ];
  const R = 34, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="hx">
      <div className="hx-top">
        <svg className="hx-ring" viewBox="0 0 88 88" role="img" aria-label={`Top 10 wallets hold ${d.top10Pct.toFixed(1)}%`}>
          <circle cx="44" cy="44" r={R} fill="none" stroke="var(--surface-3)" strokeWidth="12" />
          {parts.map((p) => {
            const len = (Math.min(100, p.v) / 100) * C;
            const el = <circle key={p.k} cx="44" cy="44" r={R} fill="none" stroke={p.c} strokeWidth="12" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 44 44)" />;
            off += len;
            return el;
          })}
          <text x="44" y="42" textAnchor="middle" className="hx-ringv">{d.top10Pct.toFixed(0)}%</text>
          <text x="44" y="55" textAnchor="middle" className="hx-ringk">top 10</text>
        </svg>
        <div className="hx-legend">
          {parts.filter((p) => p.v > 0.05).map((p) => (
            <span key={p.k}><i style={{ background: p.c }} />{p.k} <b className="mono">{p.v.toFixed(1)}%</b></span>
          ))}
        </div>
        <div className="hx-facts">
          <div><span>Holders</span><b className="mono">{d.holders.toLocaleString("en-US")}{d.partial ? "+" : ""}</b></div>
          <div><span>Linked</span><b className={`mono ${d.linkedGroups.length ? "neg" : "pos"}`}>{d.linkedGroups.length ? `${d.linkedGroups.reduce((s, g) => s + g.wallets, 0)} wallets` : "none"}</b></div>
        </div>
      </div>
      {d.linkedGroups.map((g) => (
        <p key={g.funder} className="hint th-linkwarn" style={{ margin: 0 }}>
          {g.wallets} top wallets share a first funder (<a href={scan(g.funder)} target="_blank" rel="noopener noreferrer">{shortAddr(g.funder)}</a>) and hold {g.pct.toFixed(1)}% together.
        </p>
      ))}
      <div className="hx-rows">
        {d.rows.map((r, i) => (
          <a key={r.address} className="hx-row" href={scan(r.address)} target="_blank" rel="noopener noreferrer" title={r.address}>
            <span className="hx-n">{i + 1}</span>
            <span className="mono hx-a">{shortAddr(r.address)}</span>
            <span className="hx-tags">
              {creator && r.address.toLowerCase() === creator.toLowerCase() && <em className="dev">DEV</em>}
              {me && r.address.toLowerCase() === me.toLowerCase() && <em>YOU</em>}
              {r.linked && <em className="linked">LINKED</em>}
            </span>
            <span className="hx-bar"><i style={{ width: `${Math.min(100, r.pct * 3)}%` }} /></span>
            <span className="mono hx-p">{r.pct.toFixed(2)}%</span>
          </a>
        ))}
        {d.rows.length === 0 && <p className="hint" style={{ margin: 0 }}>Per-wallet rows aren&apos;t available right now.</p>}
      </div>
    </div>
  );
}
