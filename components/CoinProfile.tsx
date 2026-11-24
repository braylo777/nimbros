"use client";

import { useEffect, useState } from "react";
import { cleanProfile, profileMessage, type Profile } from "@/lib/profile";
import { Tip } from "./Tip";

/* Links the coin's creator published (X, website, Telegram, "same project on another chain"). Anyone can read them;
   only the wallet that controls the coin's mint can set them, by signing a message with that wallet. */

export function useProfile(coin: string): [Profile, () => void] {
  const [s, setS] = useState<{ coin: string; p: Profile } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(`/api/coin/profile?coin=${encodeURIComponent(coin)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Profile>) : {}))
      .then((p) => alive && setS({ coin, p }))
      .catch(() => alive && setS({ coin, p: {} }));
    return () => {
      alive = false;
    };
  }, [coin, tick]);
  return [s && s.coin === coin ? s.p : {}, () => setTick((n) => n + 1)];
}

export function ProfileChips({ profile }: { profile: Profile }) {
  const links: [string, string][] = [];
  if (profile.telegram) links.push(["Telegram", profile.telegram]);
  return (
    <>
      {links.map(([label, url]) => (
        <Tip key={label} title={label} rows={[[label, url]]}>
          <a className="th-tag link" href={url} target="_blank" rel="noopener noreferrer nofollow">{label}</a>
        </Tip>
      ))}
      {profile.pair && (
        <Tip title={`Also on ${profile.pair.chain}`} rows={[["Address", profile.pair.ref]]} foot="Set by the coin's creator; not verified by NimBros.">
          <span className="th-tag">
            Also on {profile.pair.chain}: <span className="mono">{profile.pair.ref.length > 14 ? `${profile.pair.ref.slice(0, 6)}…${profile.pair.ref.slice(-4)}` : profile.pair.ref}</span>
          </span>
        </Tip>
      )}
    </>
  );
}

export interface ProfileForm { x: string; website: string; telegram: string; pairChain: string; pairRef: string; description?: string; icon?: string }
export const EMPTY_FORM: ProfileForm = { x: "", website: "", telegram: "", pairChain: "", pairRef: "", description: "", icon: "" };

export const formToProfile = (f: ProfileForm) =>
  cleanProfile({ x: f.x, website: f.website, telegram: f.telegram, description: f.description ?? "", icon: f.icon ?? "", pair: f.pairChain || f.pairRef ? { chain: f.pairChain, ref: f.pairRef } : null });

/** Sign and publish. Returns an error message, or null on success. */
export async function saveProfile(coinType: string, address: string, f: ProfileForm, signMessage: (m: Uint8Array) => Promise<string>): Promise<string | null> {
  const profile = formToProfile(f);
  if (!profile) return "Links must be https (X/Twitter and Telegram links must be on those sites). Pair needs a chain name and address.";
  try {
    const signature = await signMessage(new TextEncoder().encode(profileMessage(coinType, profile)));
    const r = await fetch("/api/coin/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coinType, address, profile, signature }) });
    if (r.ok) return null;
    return ((await r.json()) as { error?: string }).error ?? "Couldn't save the links.";
  } catch {
    return "The wallet declined, or the request failed. Nothing was saved.";
  }
}

export function ProfileFields({ f, set, className }: { f: ProfileForm; set: (k: keyof ProfileForm, v: string) => void; className?: string }) {
  return (
    <div className={className} style={{ display: "grid", gap: 8 }}>
      <input className="field" placeholder="X / Twitter link (https://x.com/…)" value={f.x} maxLength={200} onChange={(e) => set("x", e.target.value)} />
      <input className="field" placeholder="Website (https://…)" value={f.website} maxLength={200} onChange={(e) => set("website", e.target.value)} />
      <input className="field" placeholder="Telegram (https://t.me/…)" value={f.telegram} maxLength={200} onChange={(e) => set("telegram", e.target.value)} />
    </div>
  );
}

export function EditProfile({ coinType, address, initial, signMessage, onSaved }: { coinType: string; address: string; initial: Profile; signMessage: (m: Uint8Array) => Promise<string>; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<ProfileForm>(EMPTY_FORM);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = () => {
    setF({ x: initial.x ?? "", website: initial.website ?? "", telegram: initial.telegram ?? "", pairChain: initial.pair?.chain ?? "", pairRef: initial.pair?.ref ?? "", description: initial.description ?? "", icon: initial.icon ?? "" });
    setErr(null);
    setOpen(true);
  };
  return (
    <>
      <button className="th-tag link" onClick={start}>+ Add links</button>
      {open && (
        <div className="scrim" onClick={() => !busy && setOpen(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="paneltitle" style={{ marginBottom: 0 }}>Coin links</div>
            <ProfileFields f={f} set={(k, v) => setF((p) => ({ ...p, [k]: v }))} />
            <p className="hint">You&apos;ll sign a message (no fee, no transaction) so we know you control this coin&apos;s mint.</p>
            {err && <p className="modalmsg" style={{ color: "var(--neg)" }}>{err}</p>}
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const e = await saveProfile(coinType, address, f, signMessage);
                setBusy(false);
                if (e) return setErr(e);
                setOpen(false);
                onSaved();
              }}
            >
              {busy ? "Waiting for your wallet…" : "Sign & save"}
            </button>
            <button className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
