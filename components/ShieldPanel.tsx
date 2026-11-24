"use client";

import { useState } from "react";
import { useApp } from "./AppState";
import { requestWallet } from "@/lib/walletStore";
import { WalletModal } from "./Chrome";
import { shortAddr } from "@/lib/store";
import { screenBeforeSign, useScan, type ScanResult, type ScreenResponse } from "@/lib/shieldClient";
import { isSolAddress } from "@/lib/chain";
import type { Finding } from "@/lib/shield";

/* Wallet Shield: the security home. Three SuperAgents sit on top of the same rules the swap path uses:
   Sentinel watches the wallet, Auditor screens a transaction before you sign, Guardian removes what other addresses may spend. */

const LEVEL_LABEL = { safe: "Protected", attention: "Needs attention", danger: "At risk" } as const;
const dot = (l: string) => (l === "block" || l === "danger" ? "var(--neg)" : l === "warn" || l === "attention" ? "#c98a00" : l === "safe" ? "var(--pos)" : "var(--text-tertiary)");

function FindingList({ items }: { items: Finding[] }) {
  if (items.length === 0) return <p className="hint" style={{ margin: 0 }}>Nothing suspicious found.</p>;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
      {items.map((f, i) => (
        <li key={i} style={{ display: "grid", gridTemplateColumns: "10px 1fr", gap: 8, alignItems: "start", fontSize: "var(--text-sm)" }}>
          <i style={{ width: 8, height: 8, borderRadius: 4, background: dot(f.level), marginTop: 5 }} />
          <span>{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

type Tone = "ok" | "care" | "risk" | "idle";
const ICONS: Record<string, string> = {
  Sentinel: "M2 12s3.600-7 10-7 10 7 10 7-3.600 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z",
  Auditor: "M9 3h6l5 5v13H4V3h5zM8 13l3 3 5-6",
  Guardian: "M12 3l8 3v5c0 5-3.500 8.500-8 10-4.500-1.500-8-5-8-10V6l8-3z",
};

/* An agent card: icon, name, what it does, a live status pill, and a body that opens on tap. */
function Agent({ name, role, status, tone, open, children }: { name: string; role: string; status: string; tone: Tone; open?: boolean; children: React.ReactNode }) {
  const [on, setOn] = useState(!!open);
  return (
    <section className={`ag2 ag2-${tone}${on ? " open" : ""}`}>
      <button className="ag2-head" onClick={() => setOn((v) => !v)} aria-expanded={on}>
        <span className="ag2-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name]} /></svg></span>
        <span className="ag2-t"><b>{name}</b><small>{role}</small></span>
        <span className="ag2-pill">{status}</span>
        <span className="ag2-chev" aria-hidden="true">›</span>
      </button>
      {on && <div className="ag2-body">{children}</div>}
    </section>
  );
}

function Sentinel({ scan }: { scan: ScanResult | null }) {
  const bad = scan ? scan.findings.filter((f) => f.level === "warn" || f.level === "block").length : 0;
  return (
    <Agent name="Sentinel" role="Watches your wallet while it is open" open={bad > 0} status={!scan ? "Idle" : bad > 0 ? `${bad} alert${bad === 1 ? "" : "s"}` : scan.complete ? "All clear" : "Partly checked"} tone={!scan ? "idle" : bad > 0 ? "risk" : scan.complete ? "ok" : "idle"}>
      {scan ? (
        <>
          <FindingList items={scan.findings} />
          {scan.holdings.length > 0 && <p className="hint" style={{ margin: 0 }}>{scan.holdings.length} coin{scan.holdings.length === 1 ? "" : "s"} checked for live mint or freeze keys, concentrated ownership and serial deployers.</p>}
          {scan.degraded.length > 0 && <p className="hint" style={{ margin: 0 }}>Couldn&apos;t check: {scan.degraded.join("; ")}.</p>}
        </>
      ) : (
        <p className="hint" style={{ margin: 0 }}>Connect a wallet, or paste any address above, to start watching.</p>
      )}
    </Agent>
  );
}

function Auditor({ address }: { address: string | null }) {
  const [tx, setTx] = useState("");
  const [res, setRes] = useState<ScreenResponse | "fail" | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!address) return;
    setBusy(true);
    setRes(await screenBeforeSign(tx.trim(), address).then((r) => r ?? "fail"));
    setBusy(false);
  };
  return (
    <Agent name="Auditor" role="Screens a transaction before you sign it" status={res && res !== "fail" ? (res.verdict === "safe" ? "Looks safe" : res.verdict === "review" ? "Review" : "Do not sign") : "Ready"} tone={res && res !== "fail" ? (res.verdict === "safe" ? "ok" : res.verdict === "review" ? "care" : "risk") : "idle"}>
      <textarea className="field mono" rows={3} placeholder="Paste an unsigned transaction (base64)…" value={tx} onChange={(e) => { setTx(e.target.value); setRes(null); }} style={{ resize: "vertical" }} />
      <button className="btn sm" disabled={busy || !address || tx.trim().length < 20} onClick={run}>{busy ? "Screening…" : address ? "Screen it" : "Connect a wallet first"}</button>
      {res === "fail" && <p className="hint" style={{ margin: 0, color: "var(--neg)" }}>Couldn&apos;t screen that. Don&apos;t sign what you couldn&apos;t check.</p>}
      {res && res !== "fail" && (
        <>
          <div style={{ fontWeight: 600, color: dot(res.verdict === "safe" ? "safe" : res.verdict === "review" ? "warn" : "block") }}>{res.verdict === "safe" ? "Looks safe" : res.verdict === "review" ? "Review before signing" : "Do not sign"}</div>
          <FindingList items={res.findings} />
        </>
      )}
    </Agent>
  );
}

function Guardian({ scan, address }: { scan: ScanResult | null; address: string | null }) {
  const { wallet, toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const approvals = scan?.approvals ?? [];
  const mine = !!address && wallet.address === address;

  const revoke = async (accounts: string[], key: string) => {
    if (!address || !mine) return toast("Connect the wallet you are scanning to revoke.");
    setBusy(key);
    try {
      const r = await fetch("/api/shield/revoke", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, accounts }) });
      const j = (await r.json()) as { txBytes?: string; verdict?: string; error?: string };
      if (!r.ok || !j.txBytes) return toast(j.error ?? "Couldn't build the revoke.");
      const { VersionedTransaction } = await import("@solana/web3.js"); // loaded only when a revoke is actually signed
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(j.txBytes), (c) => c.charCodeAt(0)));
      const res = await wallet.sign({ transaction: tx });
      toast(res.success ? "Approval revoked." : "The revoke didn't confirm. Check your wallet.", res.signature.slice(0, 10));
    } catch (e) {
      toast(/reject|denied|cancel/i.test(String((e as Error)?.message)) ? "Cancelled in your wallet. Nothing was sent." : "Couldn't complete that. Nothing was sent.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Agent name="Guardian" role="Removes what others may spend" status={!scan ? "Idle" : scan.approvals === null ? "Can't read" : approvals.length === 0 ? "No open approvals" : `${approvals.length} to revoke`} tone={!scan ? "idle" : scan.approvals === null ? "idle" : approvals.length === 0 ? "ok" : "risk"}>
      {scan && scan.approvals === null && <p className="hint" style={{ margin: 0 }}>Approvals can&apos;t be read right now (the RPC node refuses indexed reads).</p>}
      {scan && approvals.length === 0 && scan.approvals !== null && <p className="hint" style={{ margin: 0 }}>No token approvals are open. Nobody else can spend your coins.</p>}
      {approvals.map((a) => (
        <div key={a.account} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", fontSize: "var(--text-sm)" }}>
          <span><span className="mono">{a.delegate ? shortAddr(a.delegate) : "?"}</span> can spend <span className="mono">{shortAddr(a.mint)}</span></span>
          <button className="btn sm" disabled={busy !== null} onClick={() => revoke([a.account], a.account)}>{busy === a.account ? "…" : "Revoke"}</button>
        </div>
      ))}
      {approvals.length > 1 && <button className="btn ghost sm" disabled={busy !== null} onClick={() => revoke(approvals.slice(0, 10).map((a) => a.account), "all")}>{busy === "all" ? "…" : `Revoke all ${Math.min(10, approvals.length)}`}</button>}
      <div className="hint" style={{ margin: 0, borderTop: "1px solid var(--border-subtle)", paddingTop: 8 }}>
        <b>Sweep to safety</b> (auto-move funds to a safe wallet on a threat) is designed but switched off: it needs you to delegate authority, so it waits for a
        security review and legal sign-off. Revoking is fully non-custodial: you sign every transaction.
      </div>
    </Agent>
  );
}

export function ShieldPanel() {
  const { wallet } = useApp();
  const [typed, setTyped] = useState("");
  const [picker, setPicker] = useState(false);
  const [pasted, setPasted] = useState<string | null>(null);
  const address = pasted ?? wallet.address;
  const [scan, reload] = useScan(address);
  const data = scan.status === "ok" ? scan.data : scan.status === "error" ? scan.prev ?? null : null;

  return (
    <div className="ag2-wrap">
      {!wallet.address && <button className="btn sm" onClick={() => { requestWallet(); setPicker(true); }}>Connect wallet</button>}
      {scan.status === "loading" && <p className="hint" style={{ margin: 0 }}>Scanning…</p>}
      {scan.status === "error" && <p className="hint" style={{ margin: 0, color: "var(--neg)" }}>Couldn&apos;t scan right now. Retrying.</p>}

      <div className="ag2-stack">
        <Sentinel scan={data} />
        <Auditor address={address} />
        <Guardian scan={data} address={address} />
      </div>
      {picker && <WalletModal onClose={() => setPicker(false)} />}
    </div>
  );
}
