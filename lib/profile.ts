/* Creator-published coin links. Pure; shared by the server (validation) and the UI (signing, display). */

export interface Profile {
  x?: string;
  website?: string;
  telegram?: string;
  /** the same project on another coin/chain, e.g. { chain: "Solana", ref: "So111…" } */
  pair?: { chain: string; ref: string };
  /** the launcher's own words and logo link, shown on the coin's NimBros page */
  description?: string;
  icon?: string;
}

const https = (v: unknown, hosts?: RegExp): string | undefined => {
  if (typeof v !== "string" || v.trim() === "") return undefined;
  const t = v.trim();
  if (t.length > 200 || !/^[\x21-\x7E]+$/.test(t)) return null as never;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" || u.username || u.password) return null as never;
    if (hosts && !hosts.test(u.hostname)) return null as never;
    return u.toString();
  } catch {
    return null as never;
  }
};

/** Returns a cleaned profile, or null if any provided field is invalid. Empty fields are dropped. */
export function cleanProfile(input: unknown): Profile | null {
  if (!input || typeof input !== "object") return null;
  const i = input as Record<string, unknown>;
  const out: Profile = {};
  const x = https(i.x, /^(www\.)?(x|twitter)\.com$/i);
  const web = https(i.website);
  const tg = https(i.telegram, /^(www\.)?(t\.me|telegram\.me)$/i);
  if (x === null || web === null || tg === null) return null;
  if (x) out.x = x;
  if (web) out.website = web;
  if (tg) out.telegram = tg;
  if (i.description !== undefined && i.description !== null && i.description !== "") {
    if (typeof i.description !== "string" || i.description.trim().length > 200 || /[\u0000-\u001f<>]/.test(i.description)) return null;
    out.description = i.description.trim();
  }
  const icon = https(i.icon);
  if (icon === null) return null;
  if (icon) out.icon = icon;
  if (i.pair !== undefined && i.pair !== null) {
    const p = i.pair as Record<string, unknown>;
    const chain = typeof p.chain === "string" ? p.chain.trim() : "";
    const ref = typeof p.ref === "string" ? p.ref.trim() : "";
    if (chain || ref) {
      if (!/^[A-Za-z0-9 ._-]{2,20}$/.test(chain) || !/^[A-Za-z0-9:_.\-$]{2,120}$/.test(ref)) return null;
      out.pair = { chain, ref };
    }
  }
  return out;
}

/** The exact text the creator signs. Stable key order so both sides produce identical bytes. */
export const profileMessage = (coinType: string, p: Profile): string =>
  `nimbros-profile:${coinType}:${JSON.stringify({ x: p.x ?? "", website: p.website ?? "", telegram: p.telegram ?? "", description: p.description ?? "", icon: p.icon ?? "", pair: p.pair ? { chain: p.pair.chain, ref: p.pair.ref } : null })}`;
