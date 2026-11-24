"use client";

import { useEffect, useState } from "react";
import type { Token } from "@/lib/types";
import type { Safety } from "@/lib/safety";
import { quickCheck, quickCheckLabel } from "@/lib/quickCheck";
import type { SellState } from "./HolderRisk";
import { Tip } from "./Tip";
import { fmtUsd } from "@/lib/store";

/* One card at the top of a coin page: can you sell it, can more be minted, can your tokens be frozen, is there enough liquidity, who holds it.
   Every row is pass, warn, fail or unchecked. Anything we could not read is "unchecked", never a pass. Built only from checks that already exist. */

type L = "pass" | "warn" | "fail" | "unk";
interface Row { k: string; v: string; l: L; why: string }

const ORDER: Record<L, number> = { fail: 3, warn: 2, unk: 1, pass: 0 };

export function SafetySummary({ tok, sell }: { tok: Token; sell: SellState }) {
  const [safe, setSafe] = useState<{ coin: string; s: Safety | "error" } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/safety?coin=${encodeURIComponent(tok.contract)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Safety>) : Promise.reject(new Error(String(r.status)))))
      .then((s) => alive && setSafe({ coin: tok.contract, s }))
      .catch(() => alive && setSafe({ coin: tok.contract, s: "error" }));
    return () => { alive = false; };
  }, [tok.contract]);
  const cur = safe && safe.coin === tok.contract ? safe.s : null;
  const chk = (key: string) => (cur && cur !== "error" ? cur.checks.find((c) => c.key === key) : undefined);

  const rows: Row[] = [];
  // 1. can you sell it
  if (sell.status === "loading") rows.push({ k: "Can you sell it?", v: "Checking…", l: "unk", why: "A test sale is being simulated." });
  else if (sell.verdict === "ok") rows.push({ k: "Can you sell it?", v: "Yes", l: "pass", why: "A simulated sale by a real holder went through." });
  else if (sell.verdict === "taxed") rows.push({ k: "Can you sell it?", v: "Yes, with a tax", l: "warn", why: sell.note ?? "A transfer tax was taken in the test sale." });
  else if (sell.verdict === "blocked") rows.push({ k: "Can you sell it?", v: "No", l: "fail", why: sell.reason ?? "The test sale was refused." });
  else rows.push({ k: "Can you sell it?", v: "Unchecked", l: "unk", why: sell.reason ?? "The test sale couldn't run." });
  // 2-3. mint and freeze keys
  for (const [key, label] of [["mint", "More can be minted?"], ["freeze", "Tokens can be frozen?"]] as const) {
    const c = chk(key);
    rows.push(!cur ? { k: label, v: "Checking…", l: "unk", why: "Reading the chain." } : !c || c.level === "unknown" ? { k: label, v: "Unchecked", l: "unk", why: "Couldn't read the chain." } : c.level === "good" ? { k: label, v: "No", l: "pass", why: c.detail } : { k: label, v: "Yes", l: "warn", why: c.detail });
  }
  // 4. liquidity
  rows.push(tok.liquidity < 2_000 ? { k: "Liquidity", v: fmtUsd(tok.liquidity), l: "fail", why: "Very little liquidity: hard to sell without moving the price." } : tok.liquidity < 10_000 ? { k: "Liquidity", v: fmtUsd(tok.liquidity), l: "warn", why: "Thin liquidity: expect big price moves when you trade." } : { k: "Liquidity", v: fmtUsd(tok.liquidity), l: "pass", why: "Enough depth for small trades." });
  // 5. concentration
  rows.push(tok.top10Pct === undefined ? { k: "Top 10 holders", v: "Unchecked", l: "unk", why: "This feed doesn't provide holder concentration." } : tok.top10Pct > 80 ? { k: "Top 10 holders", v: `${tok.top10Pct.toFixed(0)}%`, l: "fail", why: "A few wallets hold almost everything." } : tok.top10Pct > 50 ? { k: "Top 10 holders", v: `${tok.top10Pct.toFixed(0)}%`, l: "warn", why: "Ownership is concentrated." } : { k: "Top 10 holders", v: `${tok.top10Pct.toFixed(0)}%`, l: "pass", why: "Spread across many wallets." });

  const worst = rows.reduce<L>((a, r) => (ORDER[r.l] > ORDER[a] ? r.l : a), "pass");
  const unchecked = rows.filter((r) => r.l === "unk").length;
  const qc = quickCheck(tok);
  const head = worst === "fail" ? "High risk" : worst === "warn" ? "Be careful" : unchecked > 0 ? "Nothing bad found so far" : "No red flags found";
  const sub = worst === "fail" ? "At least one check failed. Think twice before buying." : worst === "warn" ? "Some checks need a closer look." : unchecked > 0 ? `${unchecked} check${unchecked === 1 ? "" : "s"} couldn't run. Unchecked is not the same as safe.` : "This is a screen of what can be read, not a guarantee.";

  return (
    <section className={`sumcard sc-${worst === "unk" ? "pass" : worst}`} aria-label="Safety summary">
      <div className="sc-head">
        <span className="sc-dot" />
        <div><b>{head}</b><small>{sub}</small></div>
        <span className={`qc qc-${qc.level}`}>{quickCheckLabel(qc.level)}</span>
      </div>
      <div className="sc-rows">
        {rows.map((r) => (
          <Tip key={r.k} title={r.k} foot={r.why}>
            <div className={`sc-row l-${r.l}`}>
              <i />
              <span className="sc-k">{r.k}</span>
              <span className="sc-v mono">{r.v}</span>
            </div>
          </Tip>
        ))}
      </div>
    </section>
  );
}
