"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFrameable } from "@/lib/liveFrame";

/* Desktop hover cards, in the style of a trading terminal: hover or keyboard-focus the icon and a small dark card explains it.
   Pure CSS to show and hide, so it costs nothing until used; phones (no hover) never see it and keep their normal tap behaviour. */
export function Tip({ children, title, rows, foot, image, avatar, bare, noTitle, scroll, live, liveCheck }: { /** show this address as a live, usable page inside the card */ live?: string; /** show this page live too, if the site allows being framed */ liveCheck?: string; /** a tall picture the pointer can scroll through, like the page itself */ scroll?: boolean; children: React.ReactNode; title: string; rows?: [string, string, string?][]; foot?: string; /** picture only: no title or text */ bare?: boolean; /** rows only: leave the heading off */ noTitle?: boolean; /** a picture of the page this links to */ image?: string; /** a profile picture, shown beside the title */ avatar?: string }) {
  const [imgOk, setImgOk] = useState(true);
  const [tries, setTries] = useState(0);
  const [avOk, setAvOk] = useState(true);
  const host = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  /* Shown at fixed screen coordinates, so the card is never cut off by the header or card it sits inside. It opens below the icon, or above
     it when there is no room, and slides left rather than run off the right edge. */
  const show = () => {
    if (typeof window === "undefined" || !window.matchMedia("(hover: hover)").matches || !host.current) return;
    const r = host.current.getBoundingClientRect();
    setAt({ x: r.left, y: r.bottom + 8 });
  };
  /* the card stays open while the pointer travels from the icon onto the card (so its links can be clicked), and closes shortly after it leaves both */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const canFrame = useFrameable(liveCheck, !!at && !!liveCheck);
  const frameSrc = live ?? (canFrame ? liveCheck : undefined);
  const hide = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setAt(null), 220); };
  const keep = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => {
    if (!at || !pop.current || !host.current) return;
    const p = pop.current.getBoundingClientRect(), r = host.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.left, window.innerWidth - p.width - 8));
    const y = r.bottom + 8 + p.height > window.innerHeight - 8 ? Math.max(8, r.top - p.height - 8) : r.bottom + 8;
    if (Math.abs(x - at.x) > 0.5 || Math.abs(y - at.y) > 0.5) setAt({ x, y });
  }, [at]);
  return (
    <span className="tip" ref={host} onMouseEnter={() => { keep(); show(); }} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {at && createPortal(
        /* mounted on <body>: the header and cards have effects (blur, transforms) that would otherwise clip or re-anchor a fixed card */
        <span ref={pop} className={`tip-pop${image ? " wide" : ""}${bare && image && imgOk ? " bare" : ""}${scroll ? " scrollcard" : ""}${frameSrc ? " livecard" : ""}`} role="tooltip" style={{ left: at.x, top: at.y }} onMouseEnter={keep} onMouseLeave={hide}>
          {frameSrc && image && (
            /* the picture shows at once while the live page loads behind it, then the live page takes over */
            // eslint-disable-next-line @next/next/no-img-element -- placeholder under the live frame
            <img className="tip-under" src={image} alt="" referrerPolicy="no-referrer" />
          )}
          {frameSrc && (
            <iframe className={`tip-live${frameLoaded ? " ready" : ""}`} src={frameSrc} title={title} sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms" referrerPolicy="no-referrer" loading="eager" onLoad={() => setFrameLoaded(true)} />
          )}
          {!frameSrc && image && imgOk && (
            <span className={`tip-shotbox${loaded ? " ready" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a live preview of the linked page, loaded only while the card is open */}
              <img className="tip-shot" src={tries ? `${image}${image.includes("?") ? "&" : "?"}r=${tries}` : image} alt="" referrerPolicy="no-referrer" onError={() => { if (tries < 8) setTimeout(() => setTries((n) => n + 1), 2500); else setImgOk(false); }} onLoad={() => { setLoaded(true); setAt((a) => (a ? { ...a } : a)); }} />
            </span>
          )}
          {(!bare || !(image && imgOk)) && !frameSrc && !noTitle && <span className="tip-head">
            {avatar && avOk && (
              // eslint-disable-next-line @next/next/no-img-element -- profile picture for the hover card
              <img className="tip-av" src={avatar} alt="" referrerPolicy="no-referrer" onError={() => setAvOk(false)} />
            )}
            <b className="tip-title">{title}</b>
          </span>}
          {(!bare || !(image && imgOk)) && !frameSrc && rows?.map(([k, v, href]) => (
            href ? (
              <a key={k} className="tip-row tip-rowlink" href={href} target="_blank" rel="noopener noreferrer"><span>{k}</span><span className="mono">{v}</span></a>
            ) : (
              <span key={k} className="tip-row"><span>{k}</span><span className="mono">{v}</span></span>
            )
          ))}
          {(!bare || !(image && imgOk)) && !frameSrc && foot && <span className="tip-foot">{foot}</span>}
        </span>,
        document.body,
      )}
    </span>
  );
}

/** Right-click a coin's name or logo for quick actions: copy the address or name, search the web or X for it. */
export function CoinMenu({ children, name, ticker, contract }: { children: React.ReactNode; name: string; ticker: string; contract: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", esc); };
  }, [at]);
  const copy = (t: string) => { try { void navigator.clipboard.writeText(t); } catch { /* clipboard blocked */ } };
  const q = encodeURIComponent(name);
  const short = `${contract.split("::")[0].slice(0, 6)}…${contract.split("::")[0].slice(-4)}`;
  const items: { label: string; run: () => void }[] = [
    { label: `Copy ${short}`, run: () => copy(contract) },
    { label: `Copy ${name}`, run: () => copy(name) },
    { label: `Google for ${name}`, run: () => window.open(`https://www.google.com/search?q=${q}`, "_blank", "noopener,noreferrer") },
    { label: `X search for ${name}`, run: () => window.open(`https://x.com/search?q=${q}`, "_blank", "noopener,noreferrer") },
    { label: `Search for ticker ${ticker}`, run: () => window.open(`https://x.com/search?q=${encodeURIComponent("$" + ticker)}`, "_blank", "noopener,noreferrer") },
  ];
  return (
    <span ref={box} onContextMenu={(e) => { e.preventDefault(); setAt({ x: e.clientX, y: e.clientY }); }} style={{ display: "contents" }}>
      {children}
      {at && createPortal(
        <span className="cm" role="menu" style={{ left: Math.min(at.x, window.innerWidth - 260), top: Math.min(at.y, window.innerHeight - 220) }}>
          {items.map((i) => (
            <button key={i.label} role="menuitem" className="cm-item" onClick={(e) => { e.stopPropagation(); i.run(); setAt(null); }}>{i.label}</button>
          ))}
        </span>,
        document.body,
      )}
    </span>
  );
}
