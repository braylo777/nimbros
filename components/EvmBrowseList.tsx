"use client";

import { useEffect, useState } from "react";
import { EVM_CHAINS, type Chain, type ChainId } from "@/lib/chains";
import { ChainLogo } from "./LaunchPanel";
import { SolMark } from "./Chrome";
import { fmtPct, fmtUsd } from "@/lib/store";
import { QUICK_AMOUNTS, setQuickAmount, useQuickAmount } from "@/lib/quickAmount";
import { Bolt } from "./QuickBuy";
import { quickCheck, quickCheckLabel } from "@/lib/quickCheck";
import type { Token } from "@/lib/types";

/* Read-only browse for the EVM chains: real coins, real numbers, no trading yet. Every row links out to the pool on GeckoTerminal, since
   there is no NimBros coin page or buy path for these chains today. Kept deliberately separate from TokenList (Solana's) so this can
   never regress the working Snipe/Scalp lists — see .claude/brain/multichain-launch.md. */

export function ChainPicker({ value, onChange }: { value: ChainId | "solana"; onChange: (c: ChainId | "solana") => void }) {
  const [open, setOpen] = useState(false);
  const cur = value === "solana" ? undefined : EVM_CHAINS.find((c) => c.id === value);
  return (
    <div className="evb-pick" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button type="button" className="btn ghost sm" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {cur ? <ChainLogo c={cur} size={16} /> : null} {cur ? cur.name : "Solana"} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="evb-list" role="listbox">
          <button role="option" aria-selected={value === "solana"} className={`evb-opt${value === "solana" ? " on" : ""}`} onClick={() => { onChange("solana"); setOpen(false); }}><SolMark size={16} /> Solana</button>
          {EVM_CHAINS.map((c) => (
            <button key={c.id} role="option" aria-selected={value === c.id} className={`evb-opt${value === c.id ? " on" : ""}`} onClick={() => { onChange(c.id); setOpen(false); }}>
              <ChainLogo c={c} size={16} /> {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Chain and quick-buy size, merged into one pill: less to scan, one tap to open either. */
export function ChainAndAmountPicker({ chain, onChain }: { chain: ChainId | "solana"; onChain: (c: ChainId | "solana") => void }) {
  const [open, setOpen] = useState(false);
  const cur = chain === "solana" ? undefined : EVM_CHAINS.find((c) => c.id === chain);
  const amount = useQuickAmount();
  return (
    <div className="cap" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button type="button" className="cap-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {cur ? <ChainLogo c={cur} size={16} /> : <SolMark size={16} />}
        <span className="cap-name">{cur ? cur.name : "Solana"}</span>
        <span className="cap-div" aria-hidden="true" />
        <Bolt /> <span className="mono">{amount} SOL</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="cap-list">
          <div className="cap-group">
            <span className="cap-label">Chain</span>
            <button role="option" aria-selected={chain === "solana"} className={`evb-opt${chain === "solana" ? " on" : ""}`} onClick={() => onChain("solana")}><SolMark size={16} /> Solana</button>
            {EVM_CHAINS.map((c) => (
              <button key={c.id} role="option" aria-selected={chain === c.id} className={`evb-opt${chain === c.id ? " on" : ""}`} onClick={() => onChain(c.id)}>
                <ChainLogo c={c} size={16} /> {c.name}
              </button>
            ))}
          </div>
          <div className="cap-group">
            <span className="cap-label">Quick buy size</span>
            {QUICK_AMOUNTS.map((v) => (
              <button key={v} role="option" aria-selected={amount === v} className={`evb-opt${amount === v ? " on" : ""}`} onClick={() => { setQuickAmount(v); setOpen(false); }}>{v} SOL</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const evmCache = new Map<string, Token[]>();

export function EvmBrowseList({ chain, kind }: { chain: Chain; kind: "snipe" | "scalp" }) {
  const key = `${chain.id}:${kind}`;
  const [s, setS] = useState<{ key: string; v: { status: "loading" | "ok" | "error"; rows: Token[] } }>({ key, v: { status: "loading", rows: evmCache.get(key) ?? [] } });
  useEffect(() => {
    let alive = true;
    const cached = evmCache.get(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the chain/kind changing, before its own fetch below resolves
    if (alive && !cached) setS({ key, v: { status: "loading", rows: [] } });
    fetch(`/api/evm-feed?chain=${chain.id}&k=${kind}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ rows: Token[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => { const rows = j.rows ?? []; evmCache.set(key, rows); if (alive) setS({ key, v: { status: "ok", rows } }); })
      .catch(() => alive && setS({ key, v: { status: "error", rows: cached ?? [] } }));
    return () => { alive = false; };
  }, [chain.id, kind, key]);
  const state = s.key === key ? s.v : { status: "loading" as const, rows: evmCache.get(key) ?? [] };

  return (
    <section className="tk-card" aria-label={`${chain.name} ${kind}`}>
      <p className="evb-note">Browsing {chain.name} — real coins from the chain, read-only. Trading and NimBros safety checks aren&apos;t built for {chain.name} yet; each row opens its pool on GeckoTerminal.</p>
      <div className="tk-list">
        {state.status === "loading" && (
          <div aria-busy="true">{Array.from({ length: 6 }, (_, i) => (<div key={i} className="skelrow"><span className="skelcircle" /><span className="skelbars"><span /><span /></span></div>))}</div>
        )}
        {state.status === "error" && <div className="tk-empty"><p>Couldn&apos;t load {chain.name} coins right now.</p></div>}
        {state.status === "ok" && state.rows.length === 0 && <div className="tk-empty"><p>No {chain.name} coins match right now.</p></div>}
        {state.rows.map((t) => {
          const qc = quickCheck(t);
          const up = t.changePct >= 0;
          return (
            <a key={t.id} className="tk evb-row" href={t.poolUrl} target="_blank" rel="noopener noreferrer nofollow">
              <div className="tk-coin">
                {t.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a token's own logo from GeckoTerminal
                  <img src={t.logo} alt="" width={38} height={38} style={{ borderRadius: "50%" }} />
                ) : <span className="skelcircle" style={{ width: 38, height: 38 }} />}
                <div className="tk-name">
                  <span className="tk-title">{t.name}</span>
                  <span className="tk-sub"><span className="mono">${t.ticker}</span> <span className={`qc qc-${qc.level}`}>{quickCheckLabel(qc.level)}</span></span>
                </div>
              </div>
              <span className={`tk-chg chgpill ${up ? "pos" : "neg"}`}>{fmtPct(t.changePct)}</span>
              <div className="tk-meta">
                <span className="tk-price mono" data-label="MC">{t.marketCap > 0 ? fmtUsd(t.marketCap) : "—"}</span>
                <span className="tk-liq mono" data-label="Liq">{fmtUsd(t.liquidity)}</span>
                <span className="tk-vol mono" data-label="Vol">{fmtUsd(t.vol24h)}</span>
              </div>
              <div className="tk-act"><span className="btn ghost sm">Open ↗</span></div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
