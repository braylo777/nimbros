"use client";

import { useState } from "react";
import { QUICK_AMOUNTS, setQuickAmount, useQuickAmount } from "@/lib/quickAmount";
import { Bolt } from "./QuickBuy";

/* The preset behind every green bolt button on the list. Pick it once here. */
export function QuickPresetMenu() {
  const cur = useQuickAmount();
  const [open, setOpen] = useState(false);
  return (
    <div className="qp" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button className="qp-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} title="Quick buy size">
        <Bolt /> {cur} SOL <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="qp-list" role="listbox" aria-label="Quick buy size">
          {QUICK_AMOUNTS.map((v) => (
            <button key={v} role="option" aria-selected={cur === v} className={`qp-opt${cur === v ? " on" : ""}`} onClick={() => { setQuickAmount(v); setOpen(false); }}>{v} SOL</button>
          ))}
        </div>
      )}
    </div>
  );
}
