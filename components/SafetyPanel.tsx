"use client";

import { useEffect, useState } from "react";
import type { Safety } from "@/lib/safety";
import type { Token } from "@/lib/types";
import { marketRisk } from "@/lib/risk";

const DOT: Record<string, string> = { good: "pos", warn: "neg", bad: "neg", unknown: "" };
const MARK: Record<string, string> = { good: "Locked", warn: "Risk", unknown: "Unverified" };

/* Real on-chain checks. Anything we can't read is shown as Unverified, never as safe. */
export function SafetyPanel({ tok }: { tok: Token }) {
  const [res, setRes] = useState<{ coin: string; s: Safety | "error" } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/safety?coin=${encodeURIComponent(tok.contract)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Safety>) : Promise.reject(new Error(String(r.status)))))
      .then((s) => alive && setRes({ coin: tok.contract, s }))
      .catch(() => alive && setRes({ coin: tok.contract, s: "error" }));
    return () => {
      alive = false;
    };
  }, [tok.contract]);

  const cur = res && res.coin === tok.contract ? res.s : null;
  const risk = marketRisk(tok);

  return (
    <div className="panel">
      <div className={`riskhead ${risk.level}`}>{risk.headline}</div>

      <div className="paneltitle" style={{ marginTop: 12 }}>Can you get out?</div>
      {risk.rows.map((r) => (
        <div className="trustrow" key={r.key} title={r.detail}>
          <span className="k">{r.label}</span>
          <span className={`v mono ${DOT[r.level]}`}>{r.value}</span>
        </div>
      ))}

      <div className="paneltitle" style={{ marginTop: 12 }}>On-chain safety</div>
      {!cur && <p className="hint">Reading the chain…</p>}
      {cur === "error" && <p className="hint">Couldn&apos;t read the chain &mdash; unverified.</p>}
      {cur && cur !== "error" && (
        <>
          {cur.checks.map((c) => (
            <div className="trustrow" key={c.key} title={c.detail}>
              <span className="k">{c.label}</span>
              <span className={`v ${DOT[c.level]}`}>{c.key === "supply" ? c.detail : MARK[c.level]}</span>
            </div>
          ))}
          <p className="hint" style={{ marginTop: 8 }}>Not checked: holders, contract code, sell blocks.</p>
        </>
      )}
    </div>
  );
}
