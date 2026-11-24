"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppState";
import { useFeed } from "@/lib/feedStore";
import { isSolAddress, solscanAccount, solscanTx } from "@/lib/chain";
import { shortAddr } from "@/lib/store";

/* Social / wallet tracking. Follow any wallet (public data, nothing needed from its owner): balance, holdings, latest moves, and a warning if it is on
   the scam watchlist. The list lives in this browser; a toast fires when a followed wallet does something new while a tab is open. */

interface Follow { address: string; label: string }
interface Track {
  address: string; sol: number | null; holdings: { mint: string; ui: number }[] | null; listed: boolean; listing: { label: string; reason: string; source: string } | null; degraded: string[];
  activity: { signature: string; ts: number; ok: boolean; solDelta: number | null; tokens: { mint: string; raw: string }[] }[] | null;
}
const KEY = "nb_track";
const load = (): Follow[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as Follow[]).filter((f) => isSolAddress(f?.address) && typeof f.label === "string").slice(0, 30) : [];
  } catch { return []; }
};
const ago = (t: number) => { const s = Math.max(0, Math.floor((Date.now() - t) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

function WalletCard({ f, onRemove, symbolOf, onNew }: { f: Follow; onRemove: () => void; symbolOf: (mint: string) => string; onNew: (label: string, text: string) => void }) {
  const [t, setT] = useState<Track | "error" | null>(null);
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    const run = () =>
      fetch(`/api/track?address=${f.address}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Track>) : Promise.reject(new Error(String(r.status)))))
        .then((d) => {
          if (!alive) return;
          const top = d.activity?.[0];
          if (top && lastSig.current && top.signature !== lastSig.current) onNew(f.label, describe(top, symbolOf));
          if (top) lastSig.current = top.signature;
          setT(d);
        })
        .catch(() => alive && setT((p) => p ?? "error"));
    void run();
    const id = setInterval(run, 60_000);
    return () => { alive = false; clearInterval(id); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one poller per followed wallet
  }, [f.address]);

  return (
    <div className="tk-card" style={{ padding: 14, display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
        <div><b>{f.label}</b> <a className="mono hint" href={solscanAccount(f.address)} target="_blank" rel="noopener noreferrer">{shortAddr(f.address)}</a></div>
        <button className="btn ghost sm" onClick={onRemove}>Unfollow</button>
      </div>
      {t === null && <p className="hint" style={{ margin: 0 }}>Reading…</p>}
      {t === "error" && <p className="hint" style={{ margin: 0, color: "var(--neg)" }}>Couldn&apos;t read this wallet right now.</p>}
      {t && t !== "error" && (
        <>
          {t.listed && <p style={{ margin: 0, color: "var(--neg)", fontWeight: 600 }}>On the scam watchlist{t.listing ? `: ${t.listing.label}. ${t.listing.reason} (${t.listing.source})` : "."}</p>}
          <div className="mono" style={{ fontSize: "var(--text-sm)" }}>{t.sol === null ? "SOL —" : `${t.sol.toLocaleString("en-US", { maximumFractionDigits: 3 })} SOL`}{t.holdings ? ` · ${t.holdings.length} token${t.holdings.length === 1 ? "" : "s"}` : ""}</div>
          {t.holdings && t.holdings.length > 0 && <div className="hint" style={{ margin: 0 }}>{t.holdings.slice(0, 6).map((h) => `${h.ui.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbolOf(h.mint)}`).join(" · ")}</div>}
          {t.activity && t.activity.length > 0 && (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 3, fontSize: "var(--text-sm)" }}>
              {t.activity.slice(0, 5).map((a) => (
                <li key={a.signature}><a href={solscanTx(a.signature)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "inherit" }}><span className="mono hint">{ago(a.ts)}</span> {describe(a, symbolOf)}</a></li>
              ))}
            </ul>
          )}
          {t.degraded.length > 0 && <p className="hint" style={{ margin: 0 }}>Couldn&apos;t read: {t.degraded.join("; ")}.</p>}
        </>
      )}
    </div>
  );
}

function describe(a: NonNullable<Track["activity"]>[number], symbolOf: (m: string) => string): string {
  if (!a.ok) return "Failed transaction";
  const tok = a.tokens[0];
  const sol = a.solDelta;
  const f = (n: number) => Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
  if (tok && sol !== null && sol < -0.001 && BigInt(tok.raw) > 0n) return `Bought ${symbolOf(tok.mint)} for ${f(sol)} SOL`;
  if (tok && sol !== null && sol > 0.001 && BigInt(tok.raw) < 0n) return `Sold ${symbolOf(tok.mint)} for ${f(sol)} SOL`;
  if (tok) return `${BigInt(tok.raw) > 0n ? "Received" : "Sent"} ${symbolOf(tok.mint)}`;
  if (sol !== null && Math.abs(sol) > 0.01) return `${sol > 0 ? "Received" : "Sent"} ${f(sol)} SOL`;
  return "Transaction";
}

export function TrackPanel() {
  const { toast } = useApp();
  const feed = useFeed();
  const [list, setList] = useState<Follow[]>([]);
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [cash, setCash] = useState("");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe storage read, once on mount
  useEffect(() => { setList(load()); }, []);
  const save = (n: Follow[]) => { setList(n); try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* kept for this session */ } };
  const bySymbol = new Map([...feed.snipes, ...feed.scalps].map((t) => [t.contract, t.ticker]));
  const symbolOf = (m: string) => bySymbol.get(m) ?? shortAddr(m);
  const add = () => {
    if (!isSolAddress(addr) || list.some((f) => f.address === addr)) return toast(isSolAddress(addr) ? "Already following that wallet." : "That isn't a Solana address.");
    save([{ address: addr, label: label.trim().slice(0, 30) || shortAddr(addr) }, ...list].slice(0, 30));
    setAddr(""); setLabel("");
  };

  return (
    <div style={{ padding: 20, display: "grid", gap: 14 }}>
      <div>
        <div className="paneltitle" style={{ marginBottom: 4 }}>Track</div>
        <p className="hint" style={{ margin: 0 }}>Follow any wallet: what it holds, what it just bought or sold, and whether it is on the scam watchlist. Public data only; your list stays in this browser.</p>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="field mono" style={{ flex: "2 1 260px" }} placeholder="Wallet address" value={addr} onChange={(e) => setAddr(e.target.value.trim())} />
        <input className="field" style={{ flex: "1 1 120px" }} placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} />
        <button className="btn sm" onClick={add}>Follow</button>
      </div>
      {list.length === 0 && <p className="hint" style={{ margin: 0 }}>Nobody followed yet. Paste a wallet above.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        {list.map((f) => (
          <WalletCard key={f.address} f={f} symbolOf={symbolOf} onRemove={() => save(list.filter((x) => x.address !== f.address))} onNew={(l, text) => toast(`${l}: ${text}`)} />
        ))}
      </div>
      <div className="tk-card" style={{ padding: 14, display: "grid", gap: 8 }}>
        <b>Social signals</b>
        <p className="hint" style={{ margin: 0 }}>NimBros doesn&apos;t buy a social data feed, so it doesn&apos;t pretend to have one. Search what people are saying about a coin right now:</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="field mono" style={{ flex: "1 1 160px" }} placeholder="Ticker, e.g. BONK" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 12))} />
          <a className={`btn ghost sm${cash ? "" : " off"}`} style={{ textDecoration: "none" }} href={cash ? `https://x.com/search?q=%24${cash}&f=live` : undefined} target="_blank" rel="noopener noreferrer nofollow">Search X ↗</a>
        </div>
      </div>
    </div>
  );
}
