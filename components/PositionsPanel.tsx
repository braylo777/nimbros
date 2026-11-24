"use client";

import { useMemo } from "react";
import { useFills } from "@/lib/fills";
import { shortAddr } from "@/lib/store";
import { QuickClose } from "./QuickBuy";
import type { Token } from "@/lib/types";

/* Open positions from the trades made in this browser. Coins bought elsewhere are not listed here: this list only knows what it traded. */
export function PositionsPanel() {
  const fills = useFills();
  const open = useMemo(() => {
    const by = new Map<string, { qty: number; cost: number; ticker?: string }>();
    for (const f of fills) {
      const e = by.get(f.coin) ?? { qty: 0, cost: 0 };
      const t = Number(f.tokensRaw) / 10 ** f.decimals;
      if (f.side === "buy") { e.qty += t; e.cost += f.usd; } else if (e.qty > 0) { const sold = Math.min(t, e.qty); e.cost -= e.cost * (sold / e.qty); e.qty -= sold; }
      if (f.ticker) e.ticker = f.ticker;
      by.set(f.coin, e);
    }
    return [...by.entries()].filter(([, e]) => e.qty > 0.000001).map(([coin, e]) => ({ coin, ...e }));
  }, [fills]);
  if (open.length === 0) return <div style={{ padding: 16 }}><p className="hint" style={{ margin: 0 }}>No open positions from this browser. Buy a coin marked Looks OK and it shows up here with a Close button.</p></div>;
  return (
    <div className="pos-list">
      {open.map((p) => (
        <div key={p.coin} className="pos-row">
          <span className="pos-t"><b>{p.ticker ? `$${p.ticker}` : shortAddr(p.coin)}</b><small>cost about ${p.cost.toFixed(2)}</small></span>
          <QuickClose tok={{ contract: p.coin, ticker: p.ticker ?? shortAddr(p.coin) } as Token} />
        </div>
      ))}
    </div>
  );
}
