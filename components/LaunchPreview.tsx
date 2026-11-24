"use client";

import { useState } from "react";
import type { ProfileForm } from "./CoinProfile";

/* How the coin will look once it exists, updated as you type. Nothing here is saved or sent. */

const fmt = (n: bigint) => n.toLocaleString("en-US");
const safeUrl = (u: string) => {
  try {
    const p = new URL(u.trim());
    return p.protocol === "https:" ? p.toString() : null;
  } catch {
    return null;
  }
};

export function LaunchPreview({ name, symbol, description, iconUrl, supply, links }: { name: string; symbol: string; description: string; iconUrl: string; supply: bigint; links: ProfileForm }) {
  const [broken, setBroken] = useState<string | null>(null);
  const icon = iconUrl.trim() ? safeUrl(iconUrl) : null;
  const showImg = !!icon && broken !== icon;
  const hasX = !!links.x.trim(), hasWeb = !!links.website.trim();
  const empty = !name.trim() && !symbol.trim() && !description.trim() && !icon;

  return (
    <aside className="lx-pv" aria-label="Preview of your coin">
      <div className="lx-pv-tag"><i aria-hidden="true" />Live preview</div>
      <div className={`lx-pv-card${empty ? " dim" : ""}`}>
        <div className="lx-pv-banner" aria-hidden="true">
          {showImg && (
            // eslint-disable-next-line @next/next/no-img-element -- the launcher's own https logo link, blurred as a backdrop
            <img src={icon!} alt="" referrerPolicy="no-referrer" />
          )}
        </div>
        <div className="lx-pv-avatar">
          {showImg ? (
            // eslint-disable-next-line @next/next/no-img-element -- the launcher's own https logo link, previewed as typed
            <img src={icon!} alt="" onError={() => setBroken(icon)} referrerPolicy="no-referrer" />
          ) : (
            <span>{(symbol.trim() || name.trim() || "?").charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="lx-pv-name">{name.trim() || "Your coin"}</div>
        <div className="th-tags lx-pv-tags">
          <span className="th-tag mono">${symbol.trim() || "TICKER"}</span>
          <span className="th-tag th-age">Now</span>
          {hasX && <span className="th-tag lx-ico" title="X"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-label="X"><path d="M12.2 1.5h2.3L9.5 7.2l5.9 7.8h-4.6L7.2 10.3 3.1 15H.8l5.4-6.2L.5 1.5h4.7l3.3 4.3zm-.8 12.2h1.3L4.6 2.8H3.2z" /></svg></span>}
          {hasWeb && <span className="th-tag lx-ico" title="Website"><svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-label="Website"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5c.6.7 1.1 1.8 1.3 3H6.7c.2-1.2.7-2.3 1.3-3zM5.3 3.1A9 9 0 0 0 4.7 5.5H2.7a5.6 5.6 0 0 1 2.6-2.4zM2.3 7h2.2a12 12 0 0 0 0 2H2.3a5.5 5.5 0 0 1 0-2zm.4 3.5h2a9 9 0 0 0 .6 2.4 5.6 5.6 0 0 1-2.6-2.4zM8 13.5c-.6-.7-1.1-1.8-1.3-3h2.6c-.2 1.2-.7 2.3-1.3 3zM6.5 9a10 10 0 0 1 0-2h3a10 10 0 0 1 0 2zm4.2 3.9c.3-.7.5-1.5.6-2.4h2a5.6 5.6 0 0 1-2.6 2.4zM11.5 9a12 12 0 0 0 0-2h2.2a5.5 5.5 0 0 1 0 2zm-.2-3.5a9 9 0 0 0-.6-2.4 5.6 5.6 0 0 1 2.6 2.4z" /></svg></span>}
        </div>
        {description.trim() && <p className="lx-pv-desc">{description.trim()}</p>}
        <div className="lx-pv-stats">
          <div><span>Supply</span><b className="mono">{fmt(supply)}</b></div>
          <div><span>Market cap</span><b className="mono">—</b></div>
          <div><span>Liquidity</span><b className="mono">—</b></div>
        </div>
      </div>
    </aside>
  );
}
