"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./AppState";
import { Avatar } from "./Chrome";
import { useCoinSearch } from "@/lib/searchClient";
import { rememberToken } from "@/lib/openedTokens";
import { fmtUsd } from "@/lib/store";
import type { Token } from "@/lib/types";
import { quickCheck, quickCheckLabel } from "@/lib/quickCheck";
import { shortAddr } from "@/lib/store";

/* One search box for every coin on Solana. Type a ticker, a name or an address: matches appear right under the box, and choosing one opens its
   chart at once, exactly as if it had been clicked in Snipe or Scalp. It searches the live lists first, then all of Solana. */

const ageText = (m?: number) => (m === undefined ? "" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440).toLocaleString("en-US")}d`);

export function SearchBox({ rows }: { rows: Token[] }) {
  const { showView, setCurToken } = useApp();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState(""); // local: typing never filters the lists behind it, it only fills this dropdown
  const term = q.trim();
  const found = useCoinSearch(q);

  const results = useMemo(() => {
    if (term.length < 1) return [] as Token[];
    const t = term.toLowerCase();
    const local = rows.filter((r) => r.ticker.toLowerCase().includes(t) || r.name.toLowerCase().includes(t) || r.contract.toLowerCase().includes(t));
    const seen = new Set(local.map((r) => r.contract));
    const all = [...local, ...found.rows.filter((r) => !seen.has(r.contract))];
    // exact ticker first, then ones that start with it, then the rest by liquidity
    const score = (r: Token) => (r.ticker.toLowerCase() === t ? 0 : r.ticker.toLowerCase().startsWith(t) ? 1 : 2);
    return all.sort((a, b) => score(a) - score(b) || b.liquidity - a.liquidity).slice(0, 8);
  }, [term, rows, found.rows]);

  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, []);

  const pick = (t: Token) => {
    rememberToken(t);
    setCurToken(t.id);
    showView("trade");
    setQ("");
    setOpen(false);
    window.scrollTo({ top: 0 });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && results[cursor]) { e.preventDefault(); pick(results[cursor]); }
    else if (e.key === "Escape") { setOpen(false); (e.target as HTMLElement).blur(); }
  };

  const showList = open && term.length >= 1;
  return (
    <div className="sb" ref={box}>
      <div className="sb-field">
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="9" r="5.5" /><path d="M13.5 13.5L17 17" /></svg>
        <input
          value={q}
          placeholder="Search Coins"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          onChange={(e) => { setQ(e.target.value.slice(0, 80)); setOpen(true); setCursor(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          aria-label="Search any coin on Solana by ticker, name or address"
        />
        {q && <button type="button" className="sb-x" onClick={() => { setQ(""); setOpen(false); }} aria-label="Clear search">×</button>}
      </div>
      {showList && (
        <div className="sb-list" role="listbox">
          {results.length === 0 ? (
            <div className="sb-empty">{found.loading ? "Searching…" : "No coin found on Solana."}</div>
          ) : (
            results.map((t, i) => (
              <button key={t.id} role="option" aria-selected={i === cursor} className={`sb-row${i === cursor ? " on" : ""}`} onMouseEnter={() => setCursor(i)} onClick={() => pick(t)}>
                <Avatar id={t.id} src={t.logo} ticker={t.ticker} size={30} />
                <span className="sb-name"><b>{t.ticker} <span className={`qc qc-${quickCheck(t).level}`}>{quickCheckLabel(quickCheck(t).level)}</span></b><small>{t.name} · <span className="mono">{shortAddr(t.contract)}</span></small></span>
                <span className="sb-meta mono">{t.marketCap ? fmtUsd(t.marketCap) : fmtUsd(t.liquidity)}<small>{ageText(t.ageMin)}</small></span>
              </button>
            ))
          )}
          {found.loading && results.length > 0 && <div className="sb-more">Searching all of Solana…</div>}
        </div>
      )}
    </div>
  );
}
