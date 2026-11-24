"use client";

import { useEffect, useRef, useState } from "react";
import { useWalletStore } from "@/lib/walletStore";
import { WalletModal } from "./Chrome";
import { useSwapNow, Bolt } from "./QuickBuy";
import { formatUnits } from "@/lib/units";
import { positionFor, useFills } from "@/lib/fills";
import { parseBuy, parseSell, setBuyPreset, setSellPreset, useQuickPresets } from "@/lib/quickPresets";
import type { Token } from "@/lib/types";

/* Quick trade, Axiom style: every button is one tap. A green button buys that many SOL, a red one sells that share of what you
   hold, and the trade goes straight to signing (your wallet). The server builds and
   simulates every swap first and refuses it if the simulation doesn't match, so nothing here is a guess or a paper number. */


/* A button whose number you can change: double-click it (or press and hold on a phone) and type a new one. A single tap trades
   after a short pause, so a double-click never trades twice. */
function PresetButton({ value, kind, disabled, onTap, onEdit, label, children }: {
  value: number; kind: "buy" | "sell"; disabled: boolean; onTap: () => void; onEdit: (n: number) => void; label: string; children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const tap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const start = () => { setText(String(value)); setBad(false); setEditing(true); };
  const commit = () => {
    const n = kind === "buy" ? parseBuy(text) : parseSell(text);
    if (n === null) return setBad(true);
    onEdit(n);
    setEditing(false);
  };
  if (editing) {
    return (
      <span className={`qt-btn ${kind} editing${bad ? " bad" : ""}`}>
        <input
          autoFocus
          inputMode="decimal"
          value={text}
          aria-label={kind === "buy" ? "SOL to buy" : "Percent to sell"}
          onChange={(e) => { setText(e.target.value); setBad(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          onBlur={() => (parseBuy(text) !== null || parseSell(text) !== null ? commit() : setEditing(false))}
        />
        <small>{kind === "buy" ? "SOL" : "%"}</small>
      </span>
    );
  }
  return (
    <button
      className={`qt-btn ${kind}${disabled ? " off" : ""}`}
      aria-disabled={disabled}
      aria-label={label}
      title="Tap to trade. Double-click, or press and hold, to change the number."
      onClick={() => {
        if (held.current) { held.current = false; return; }
        if (disabled) return; // greyed out, but still editable
        if (tap.current) clearTimeout(tap.current);
        tap.current = setTimeout(onTap, 260);
      }}
      onDoubleClick={() => { if (tap.current) clearTimeout(tap.current); start(); }}
      onPointerDown={() => { held.current = false; hold.current = setTimeout(() => { held.current = true; if (tap.current) clearTimeout(tap.current); start(); }, 550); }}
      onPointerUp={() => hold.current && clearTimeout(hold.current)}
      onPointerLeave={() => hold.current && clearTimeout(hold.current)}
    >
      {children}
    </button>
  );
}

let solUsdCache: { at: number; v: number } | null = null;
/** SOL's dollar price, only used to express what you hold in SOL. */
function useSolUsd(): number | null {
  const [v, setV] = useState<number | null>(solUsdCache?.v ?? null);
  useEffect(() => {
    if (solUsdCache && Date.now() - solUsdCache.at < 60_000) return;
    let alive = true;
    fetch("/api/ref-price").then((r) => r.json() as Promise<{ median?: number }>).then((j) => {
      if (typeof j.median === "number" && j.median > 0) { solUsdCache = { at: Date.now(), v: j.median }; if (alive) setV(j.median); }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return v;
}
const sol = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : n >= 1 ? 2 : 4 })} SOL`;

export function SwapPanel({ tok }: { tok: Token }) {
  const wallet = useWalletStore();
  const swap = useSwapNow(tok);
  const presets = useQuickPresets();

  /* Held balance, so a sell button can turn "50%" into an exact amount. Read from a Solana RPC node, never assumed. */
  const [heldFor, setHeldFor] = useState<{ key: string; v: { raw: bigint; decimals: number } | "error" } | null>(null);
  const heldKey = `${wallet.address ?? ""}|${tok.contract}|${swap.busy}`;
  useEffect(() => {
    if (!wallet.address) return;
    let alive = true;
    (async () => {
      try {
        const [{ tokenBalanceRaw }, decRes] = await Promise.all([
          import("@/lib/solBalance"),
          fetch(`/api/coin/decimals?coin=${encodeURIComponent(tok.contract)}`).then((r) => r.json() as Promise<{ decimals?: number }>),
        ]);
        if (typeof decRes.decimals !== "number") throw new Error("no decimals");
        const raw = await tokenBalanceRaw(wallet.address!, tok.contract);
        if (alive) setHeldFor({ key: heldKey, v: { raw, decimals: decRes.decimals } });
      } catch {
        if (alive) setHeldFor({ key: heldKey, v: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [heldKey, wallet.address, tok.contract]);
  const held = heldFor && heldFor.key === heldKey ? heldFor.v : null;
  const solUsd = useSolUsd();

  /* Bottom bar, as on Axiom: what you put in, what you took out, what you hold, and the profit or loss between them.
     Only trades made through this app are counted as "bought" and "sold", so coins acquired elsewhere show no P&L. */
  const fills = useFills().filter((f) => f.coin === tok.contract);
  const bought = fills.filter((f) => f.side === "buy").reduce((a, f) => a + (f.sol ?? 0), 0);
  const sold = fills.filter((f) => f.side === "sell").reduce((a, f) => a + (f.sol ?? 0), 0);
  const heldOk = held && held !== "error" ? held : null;
  const pos = heldOk ? positionFor(fills, heldOk.raw, heldOk.decimals, tok.price) : null;
  const perUsd = solUsd ? 1 / solUsd : 0; // dollars -> SOL
  const holdingSol = pos ? pos.value * perUsd : 0;
  const pnl = bought > 0 && pos ? sold + pos.tracked * tok.price * perUsd - bought : 0;
  const pnlPct = bought > 0 ? (pnl / bought) * 100 : 0;
  const heldUnits = heldOk ? Number(heldOk.raw) / 10 ** heldOk.decimals : 0;
  const canSell = !!held && held !== "error" && held.raw > 0n;

  const sell = (p: number) => {
    if (!held || held === "error" || held.raw === 0n) return;
    void swap.run("sell", formatUnits(p === 100 ? held.raw : (held.raw * BigInt(p)) / 100n, held.decimals));
  };

  return (
    <div className="panel qt">
      <div className="paneltitle">Quick trade</div>

      <div className="qt-head">
        <span className="qt-label buy">Buy</span>
        <span className="qt-meta mono">{wallet.balance !== null ? `${wallet.balance.toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL` : "SOL"}</span>
      </div>
      <div className="qt-btns c3">
        {presets.buy.map((v, i) => (
          <PresetButton key={i} kind="buy" value={v} disabled={swap.busy} label={`Buy ${v} SOL of ${tok.ticker}`} onTap={() => void swap.run("buy", String(v))} onEdit={(n) => setBuyPreset(i, n)}>
            <Bolt /> {v}
          </PresetButton>
        ))}
      </div>

      <div className="qt-head">
        <span className="qt-label sell">Sell</span>
        <span className="qt-meta mono">{heldUnits > 0 ? `${heldUnits.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${tok.ticker} · ${sol(holdingSol)}` : `0 ${tok.ticker}`}</span>
      </div>
      <div className="qt-btns c4">
        {presets.sell.map((p, i) => (
          <PresetButton key={i} kind="sell" value={p} disabled={swap.busy || !canSell} label={`Sell ${p}% of your ${tok.ticker}`} onTap={() => sell(p)} onEdit={(n) => setSellPreset(i, n)}>
            {p}%
          </PresetButton>
        ))}
      </div>

      <div className="qt-bar" title="From trades made in this app">
        <div className="qt-cell buy"><span>Bought</span><b className="mono">{sol(bought)}</b></div>
        <div className="qt-cell sell"><span>Sold</span><b className="mono">{sol(sold)}</b></div>
        <div className="qt-cell"><span>Holding</span><b className="mono">{sol(holdingSol)}</b></div>
        <div className={`qt-cell pnl ${pnl >= 0 ? "buy" : "sell"}`}><span>P&amp;L</span><b className="mono">{pnl >= 0 ? "+" : "-"}{sol(Math.abs(pnl))} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(0)}%)</b></div>
      </div>

      {swap.picker && <WalletModal onClose={swap.closePicker} />}
    </div>
  );
}
