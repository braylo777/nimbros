"use client";

import { useState } from "react";
import { dexHue, dexLogoUrl, dexName } from "@/lib/dex";

/* An exchange's logo, or a lettered badge when there isn't one (or it fails to load). */
export function DexLogo({ id, size = 18 }: { id: string; size?: number }) {
  const url = dexLogoUrl(id);
  const [failed, setFailed] = useState(false);
  const common = { width: size, height: size, borderRadius: "50%", flex: "none" as const };
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} style={{ ...common, objectFit: "cover", background: "var(--surface-2)" }} />;
  }
  const hue = dexHue(id);
  return (
    <span aria-hidden="true" style={{ ...common, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.55), fontWeight: 700, background: `hsl(${hue} 60% 92%)`, color: `hsl(${hue} 50% 32%)` }}>
      {dexName(id).charAt(0)}
    </span>
  );
}

/** Logo and name together, for one line of small text. */
export function DexTag({ id, size = 14 }: { id: string; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, verticalAlign: "middle" }}>
      <DexLogo id={id} size={size} />
      {dexName(id)}
    </span>
  );
}
