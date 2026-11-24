"use client";

import { closeReceipt, useReceipt } from "@/lib/receipt";

/* Shown after every fill. "Expected" because the amount comes from the quote you signed; the exact figure is on Solscan. */
export function TradeReceipt() {
  const r = useReceipt();
  if (!r) return null;
  return (
    <div className="scrim" onClick={closeReceipt}>
      <div className="modal receipt" style={{ maxWidth: 340 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Trade receipt">
        <div className="paneltitle" style={{ marginBottom: 0 }}>{r.side === "buy" ? "Bought" : "Closed"} {r.ticker}</div>
        <div className="trustrow"><span className="k">You paid</span><span className="v mono">{r.paid}</span></div>
        <div className="trustrow"><span className="k">You got (expected)</span><span className="v mono">{r.got}</span></div>
        {r.impactPct !== null && <div className="trustrow"><span className="k">Price impact</span><span className="v mono">{r.impactPct.toFixed(2)}%</span></div>}
        <div className="trustrow"><span className="k">NimBros fee</span><span className="v mono">{r.feeBps === null ? "—" : r.feeBps === 0 ? "None" : `${(r.feeBps / 100).toFixed(2)}%`}</span></div>
        {r.networkSol !== null && <div className="trustrow"><span className="k">Network cost + deposits</span><span className="v mono">~{r.networkSol.toFixed(4)} SOL</span></div>}
        <a className="btn" style={{ textAlign: "center", textDecoration: "none" }} href={`https://solscan.io/tx/${r.sig}`} target="_blank" rel="noopener noreferrer">View on Solscan ↗</a>
        <button className="btn ghost" onClick={closeReceipt}>Done</button>
      </div>
    </div>
  );
}
