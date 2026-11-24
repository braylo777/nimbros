"use client";

import { useState } from "react";
import { useApp } from "./AppState";
import { logoFor } from "@/lib/logos";
import { Wordmark } from "./Wordmark";
import { shortAddr } from "@/lib/store";
import { MOONPAY_ENABLED } from "@/lib/moonpay";
import { requestWallet } from "@/lib/walletStore";
import { useScan } from "@/lib/shieldClient";
import { closePicker, openPicker, openPortal, usePickerOpen, usePortal } from "@/lib/hubTab";
import { WalletPortal } from "./WalletPortal";
import { TradeReceipt } from "./TradeReceipt";
import { useAgentActivity, useBreachWatch, useLight } from "@/lib/safetyState";

/* ---------- brand marks ---------- */

/** The official NimBros mark, as supplied. Aspect ratio 2.25:1. */
const MARK_ASPECT = 1535 / 682;

export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset; next/image can't optimize under `output: export`
    <img
      src="/brand/nimbros-mark@2x.png"
      alt="NimBros"
      width={Math.round(size * MARK_ASPECT)}
      height={size}
      style={{ display: "block", height: size, width: "auto" }}
    />
  );
}

/**
 * The same mark as a single-color silhouette (CSS mask over the real asset),
 * for the pegged-token badge. The multi-tone mark turns to mud at 14-18px, so
 * the badge uses the true outline in white on the brand gradient instead.
 */
function WingGlyph({ size = 10 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width: size,
        height: Math.round(size / MARK_ASPECT) + 2,
        backgroundColor: "currentColor",
        WebkitMaskImage: "url(/brand/nimbros-mark@2x.png)",
        maskImage: "url(/brand/nimbros-mark@2x.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

/**
 * Solana mark (three bars). `size` is the rendered height.
 * `tone="white"` renders the same silhouette in white, for use on top of the
 * brand-blue buttons where the gradient mark would disappear.
 */
const SOL_ASPECT = 397 / 311;
let solMarkId = 0;

export function SolMark({
  size = 14,
  tone = "brand",
}: {
  size?: number;
  tone?: "brand" | "white";
}) {
  const width = Math.round(size * SOL_ASPECT);
  const [id] = useState(() => `solg${++solMarkId}`);
  const fill = tone === "white" ? "#fff" : `url(#${id})`;
  return (
    <svg
      role="img"
      aria-label="SOL"
      viewBox="0 0 397 311"
      width={width}
      height={size}
      style={{ display: "block", height: size, width, flex: "none" }}
    >
      {tone === "brand" && (
        <defs>
          <linearGradient id={id} x1="0" y1="311" x2="397" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#9945FF" />
            <stop offset="1" stopColor="#14F195" />
          </linearGradient>
        </defs>
      )}
      <path fill={fill} d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
      <path fill={fill} d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
      <path fill={fill} d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
    </svg>
  );
}

/* ---------- app shell (full screen, no browser chrome) ---------- */

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      {children}
      <BottomNav />
    </div>
  );
}

/* Phone navigation: the three places that matter, always within thumb reach. Hidden on wide screens. */
function BottomNav() {
  const { view, showView, wallet } = useApp();
  const portal = usePortal();
  const items: { label: string; on: boolean; go: () => void; icon: string }[] = [
    { label: "Trade", on: !portal.open && (view === "home" || view === "trade"), go: () => showView("home"), icon: "M4 18l5-6 4 3 7-9" },
    { label: "Wallet", on: portal.open, go: () => { if (wallet.address) openPortal(); else { requestWallet(); openPicker(); } }, icon: "M12 3l7 3v5c0 4.500-3 8-7 10-4-2-7-5.500-7-10V6l7-3z" },
    { label: "Agents", on: !portal.open && view === "agents", go: () => showView("agents"), icon: "M8 8h8v8H8zM4 10v4M20 10v4M10 4v4M14 4v4" },
  ];
  return (
    <nav className="bottomnav" aria-label="Main">
      {items.map((i) => (
        <button key={i.label} className={i.on ? "on" : ""} onClick={i.go} aria-current={i.on ? "page" : undefined}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={i.icon} /></svg>
          {i.label}
        </button>
      ))}
    </nav>
  );
}

/* the status dot on the wallet button: the one always-visible sign of how safe the wallet is */
function WalletDot({ address, balance }: { address: string; balance: number | null }) {
  const [scan] = useScan(address);
  const d = scan.status === "ok" ? scan.data : scan.status === "error" ? scan.prev : undefined;
  useBreachWatch(balance, address);
  const agents = useAgentActivity(address);
  const { light, head } = useLight(d?.level, d?.complete, agents);
  const c = light === "green" ? "var(--pos)" : light === "yellow" ? "#e0a100" : light === "red" ? "var(--neg)" : "var(--text-tertiary)";
  return <i aria-label={head} title={head} className={light === "yellow" || light === "red" ? "lightpulse" : ""} style={{ width: 10, height: 10, borderRadius: 5, background: c, flex: "none", boxShadow: `0 0 0 3px color-mix(in srgb, ${c} 24%, transparent)` }} />;
}

/* ---------- top bar ---------- */

export function TopBar() {
  const { showView, wallet, toast } = useApp();
  // Top nav is intentionally absent: the logo returns home, and everything
  // else is reached by clicking through. On a phone this button is hidden entirely (CSS) — the bottom bar's
  // "Wallet" tab opens the same picker/portal, so there is exactly one connect button, not two.
  const pickerOpen = usePickerOpen();

  const { address, balance, balanceError, network, isConnecting } = wallet;

  /* MoonPay hosted on-ramp. The tab is opened synchronously (popup blockers
     reject window.open after an await), then pointed at the signed URL. */
  async function buySol() {
    if (!address) {
      toast("Connect a Solana wallet first.");
      return;
    }
    const w = window.open("about:blank", "_blank");
    try {
      const r = await fetch(`/api/moonpay?address=${address}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const { url } = (await r.json()) as { url: string };
      if (!url.startsWith("https://buy.moonpay.com/")) throw new Error("bad url");
      if (w) {
        w.opener = null;
        w.location.href = url;
      } else {
        toast("Allow pop-ups to open MoonPay.");
      }
    } catch {
      w?.close();
      toast("Buying SOL isn't available right now.");
    }
  }

  const balanceLabel =
    balance === null ? (balanceError ? "—" : "…") : `${balance.toFixed(3)} SOL`;

  return (
    <>
      <div className="topbar">
        <button className="logo" onClick={() => showView("home")}>
          <LogoMark size={30} />
          <Wordmark height={22} />
        </button>

        <div className="topright">
          {MOONPAY_ENABLED && (
            <button className="btn ghost sm" onClick={buySol}>
              Buy SOL
            </button>
          )}

          <button
            className="walletpill"
            onClick={() => {
              requestWallet();
              if (address) openPortal();
              else openPicker();
            }}
          >
            {address ? <WalletDot address={address} balance={balance} /> : <SolMark />}
            {address ? (
              <>
                <span className="bal">{balanceLabel}</span>
                <span className="addr">{shortAddr(address)}</span>
              </>
            ) : isConnecting ? (
              "Connecting…"
            ) : (
              <>
                Connect
              </>
            )}
          </button>
        </div>
      </div>

      {pickerOpen && <WalletModal onClose={closePicker} />}
      <WalletPortal />
      <TradeReceipt />
    </>
  );
}

/* ---------- wallet picker: real Solana Wallet Standard discovery ---------- */

export function WalletModal({ onClose }: { onClose: () => void }) {
  const { wallet, toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);

  async function pick(name: string) {
    setBusy(name);
    try {
      await wallet.connect(name);
      toast(`${name} connected.`);
      onClose();
    } catch (err) {
      const e = err as { name?: string; message?: string; error?: { code?: number; message?: string } };
      console.error("wallet connect failed", err);
      const code = e.error?.code !== undefined ? ` (code ${e.error.code})` : "";
      toast(
        e.message
          ? `Could not connect ${name}: ${e.message}${code}.${/unexpected/i.test(e.message) ? " Unlock the wallet, close other wallet extensions, and try again." : ""}`
          : "Could not connect to that wallet."
      );
    } finally {
      setBusy(null);
    }
  }

  /* Phantom first, one plain button. Other detected wallets only appear if Phantom isn't installed. */
  const phantom = wallet.wallets.find((w) => /phantom/i.test(w.name));
  const shown = phantom ? [phantom] : wallet.wallets.filter((w) => !/mobile wallet adapter/i.test(w.name));
  const mobile = typeof navigator !== "undefined" && /iPhone|iPad|Android/i.test(navigator.userAgent);
  const getHref = mobile
    ? `https://phantom.app/ul/browse/${encodeURIComponent(typeof location !== "undefined" ? location.href : "")}?ref=${encodeURIComponent(typeof location !== "undefined" ? location.origin : "")}`
    : "https://phantom.com/download";

  /* Always show the real button and let the user tap it: a wallet extension's connect prompt and (on a phone with no wallet in this
     browser) the jump into Phantom's app both have to happen inside an actual click, not a useEffect that fires on its own — iOS
     Safari silently refuses to open another app from a navigation that wasn't triggered by a direct tap, so an automatic redirect
     here could look like nothing happened at all. This also means you always SEE "Connect" and choose it yourself, every time. */
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        {shown.map((w) => (
          <button key={w.name} className="walletopt" disabled={busy !== null} onClick={() => pick(w.name)} style={{ justifyContent: "center", gap: 10 }}>
            {w.icon ? (
              /* the wallet's OWN real icon, exactly as it supplies it — never a hand-drawn stand-in when the real one is available */
              // eslint-disable-next-line @next/next/no-img-element -- wallet-provided data: URI icon
              <img src={w.icon} alt="" width={26} height={26} style={{ borderRadius: 7 }} />
            ) : /phantom/i.test(w.name) ? (
              <PhantomMark size={26} />
            ) : (
              <SolMark size={22} />
            )}
            {busy === w.name ? "Connecting…" : "Connect"}
          </button>
        ))}
        {shown.length === 0 && wallet.ready && (
          <a className="walletopt" href={getHref} target={mobile ? "_self" : "_blank"} rel="noopener noreferrer" style={{ textDecoration: "none", justifyContent: "center", gap: 10 }}>
            <PhantomMark size={24} />
            Connect
          </a>
        )}
        {shown.length === 0 && !wallet.ready && <div style={{ textAlign: "center", color: "var(--text-tertiary)" }}>…</div>}
      </div>
    </div>
  );
}

export function PhantomMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#AB9FF2" />
      <path d="M5 17.5c1.2 0 2-.9 2.6-1.8.5-.7 1-.7 1.5 0 .6.9 1.4 1.8 2.6 1.8 2.6 0 5.3-2.4 5.3-6.6C17 8.100 14.700 6 12 6S7 8.100 7 10.900v.1c0 .5-.3.9-.9.9H5.500" fill="none" stroke="#fff" strokeWidth="1.600" strokeLinecap="round" />
      <circle cx="11" cy="10.500" r="1" fill="#fff" />
      <circle cx="14.500" cy="10.500" r="1" fill="#fff" />
    </svg>
  );
}

/* ---------- toasts ---------- */

export function Toasts() {
  const { toasts } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
          {t.mono && <span className="tmono">{t.mono}</span>}
        </div>
      ))}
    </div>
  );
}

/* ---------- avatar: real token logo, monogram fallback, NimBros badge ---------- */

export function Avatar({
  id,
  ticker,
  size = 34,
  badge = false,
  badgeMuted = false,
  src: srcProp,
}: {
  badgeMuted?: boolean;
  src?: string;
  id?: string;
  ticker: string;
  size?: number;
  badge?: boolean;
}) {
  const src = srcProp ?? (id ? logoFor(id) : undefined);
  const [failed, setFailed] = useState(false);
  const badgeSize = Math.max(12, Math.round(size * 0.44));

  return (
    <span className="iconwrap" style={{ width: size, height: size }}>
      {src && !failed ? (
        /* third-party token logo from a CDN; next/image can't optimize it
           under `output: export` */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="avatar"
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="avatar mono-fallback"
          style={{ width: size, height: size, fontSize: size * 0.42 }}
        >
          {ticker.replace(/^\$/, "").slice(0, 1)}
        </span>
      )}
      {badge && (
        <span
          className="badge"
          style={{ width: badgeSize, height: badgeSize, opacity: badgeMuted ? 0.5 : 1 }}
          title={badgeMuted ? "NimBros pegged token (not launched yet)" : "NimBros-native pegged token"}
        >
          <WingGlyph size={Math.round(badgeSize * 0.66)} />
        </span>
      )}
    </span>
  );
}
