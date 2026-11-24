"use client";

import { useEffect, useState } from "react";
import { useApp } from "./AppState";
import { SolMark, PhantomMark } from "./Chrome";
import { ShieldPanel } from "./ShieldPanel";
import { PositionsPanel } from "./PositionsPanel";
import { TrackPanel } from "./TrackPanel";
import { closePortal, setHubTab, usePortal } from "@/lib/hubTab";
import { useAgentActivity, useBlockLog, useLight } from "@/lib/safetyState";
import { useScan } from "@/lib/shieldClient";
import { shortAddr } from "@/lib/store";

/* Your NimBros wallet portal: opens from the wallet button once you are connected, like a wallet extension's popup. Everything that keeps
   the wallet safe lives here: the status at the top, the security agents (Protect), the wallets you follow (Track). NimBros never holds a key:
   this panel only reads, and anything that changes the wallet is signed by you in your own wallet. */
export function WalletPortal() {
  const { wallet, toast, showView } = useApp();
  const { open, tab } = usePortal();
  const [copied, setCopied] = useState(false);
  const address = wallet.address;
  const icon = wallet.wallets.find((w) => w.name === wallet.walletName)?.icon;
  const [scan, reload] = useScan(open ? address : null);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && closePortal();
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [open]);
  useEffect(() => { if (!address) closePortal(); }, [address]);

  const d = scan.status === "ok" ? scan.data : scan.status === "error" ? scan.prev : undefined;
  const log = useBlockLog();
  const agents = useAgentActivity(open ? address : null);
  const { light, head, sub } = useLight(d?.level, d?.complete, agents);
  if (!open || !address) return null; // all hooks are above this line
  const tone = light === "red" ? "risk" : light === "yellow" ? "care" : light === "green" ? "ok" : "idle";
  const bal = wallet.balance === null ? (wallet.balanceError ? "—" : "…") : wallet.balance.toFixed(4);

  return (
    <div className="portal-scrim" onClick={closePortal}>
      <aside className="portal" role="dialog" aria-label="Your NimBros wallet" onClick={(e) => e.stopPropagation()}>
        <header className="portal-head">
          <span className="portal-av">
            {icon ? (
              /* eslint-disable-next-line @next/next/no-img-element -- wallet-provided data: URI icon */
              <img src={icon} alt="" width={42} height={42} style={{ borderRadius: 13, display: "block" }} />
            ) : wallet.walletName === "Phantom" ? <PhantomMark size={42} /> : address.slice(0, 2)}
          </span>
          <span className="portal-id">
            <b>{wallet.walletName ?? "Wallet"}</b>
            <span className="portal-addr mono">{shortAddr(address)}</span>
          </span>
          <button className="portal-ic" title="Copy address" aria-label="Copy address" onClick={async () => { try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1200); toast("Address copied."); } catch { /* selectable */ } }}>{copied ? "✓" : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h9" /></svg>}</button>
          <button className="portal-ic" title="Re-scan now" aria-label="Re-scan" onClick={reload}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 10-2.300 5.700M20 4v7h-7" /></svg></button>
          <a className="portal-ic" title="Open on Solscan" aria-label="Open on Solscan" href={`https://solscan.io/account/${address}`} target="_blank" rel="noopener noreferrer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></svg></a>
          <button className="portal-ic" title="Trading bots / API" aria-label="Trading bots and API" onClick={() => { closePortal(); showView("agents"); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="8" width="14" height="11" rx="2" /><path d="M12 8V4M9 13h.01M15 13h.01M9 16.500h6" /></svg></button>
          <button className="portal-ic" title="Disconnect wallet" aria-label="Disconnect wallet" onClick={async () => { closePortal(); await wallet.disconnect(); toast("Wallet disconnected."); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v9M6.300 6.300a8 8 0 1011.400 0" /></svg></button>
          <button className="portal-x" onClick={closePortal} aria-label="Close">×</button>
        </header>

        <div className={`portal-hero ps-${tone}`}>
          <div className="ring" role="img" aria-label={d ? `Safety score ${d.score} out of 100` : "Checking"}>
            <svg viewBox="0 0 100 100" width="64" height="64">
              <circle cx="50" cy="50" r="42" fill="none" strokeWidth="9" className="ring-bg" />
              <circle cx="50" cy="50" r="42" fill="none" strokeWidth="9" strokeLinecap="round" className="ring-fg" strokeDasharray={`${d ? (d.score / 100) * 264 : 0} 264`} transform="rotate(-90 50 50)" />
            </svg>
            <span className="ring-n mono">{d ? d.score : "…"}</span>
          </div>
          <div className="hero-txt">
            <div className="hero-bal"><SolMark size={16} /><span className="mono">{bal}</span><small>SOL</small></div>
            <b title="Green Trading: agents on, wallet clear. Yellow Blocking: a threat is present or was just blocked. Red Defending: an unexplained outflow.">{head}</b>
            <span>{sub}</span>
            {(log.screened > 0 || log.blockedToday > 0) && <em className="hero-log" title={log.blocks[0]?.why}>{log.screened} screened · {log.blockedToday} blocked{log.blocks[0] ? ` · last: ${log.blocks[0].why}` : ""}</em>}
          </div>
        </div>

        <div className="seg portal-tabs" role="tablist">
          {(["protect", "positions", "track"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`segbtn${tab === t ? " on" : ""}`} onClick={() => setHubTab(t)}>
              {t === "protect" ? "Agents" : t === "positions" ? "Positions" : "Track"}
            </button>
          ))}
        </div>

        <div className="portal-body">{tab === "protect" ? <ShieldPanel /> : tab === "positions" ? <PositionsPanel /> : <TrackPanel />}</div>

      </aside>
    </div>
  );
}
