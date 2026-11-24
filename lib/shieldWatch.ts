import type { Finding } from "./shield.ts";

/* Background watching: which findings on a watched wallet are NEW since the last time the owner was told. Pure.
   A finding is identified by its code and the thing it is about (`ref`), so a second approval on a different token account is new, and the
   same approval sitting there for a week is not re-announced. Only warn and block findings ever alert. */

export const MAX_WATCHED = 5;

export const keyOf = (f: Finding): string => `${f.code}:${f.ref ?? ""}`;
const alertable = (f: Finding): boolean => f.level === "warn" || f.level === "block";

export function newAlerts(seen: readonly string[], findings: readonly Finding[]): Finding[] {
  const had = new Set(seen);
  return findings.filter((f) => alertable(f) && !had.has(keyOf(f)));
}

/** What to remember after a successful delivery: everything currently alertable, so a finding that goes away and comes back alerts again. */
export const remember = (findings: readonly Finding[]): string[] => [...new Set(findings.filter(alertable).map(keyOf))].slice(0, 200);

export interface WatchList { addresses: string[]; seen: Record<string, string[]> }
export const emptyWatch = (): WatchList => ({ addresses: [], seen: {} });

export function withAddress(w: WatchList, address: string, on: boolean): { ok: true; list: WatchList } | { ok: false; message: string } {
  const has = w.addresses.includes(address);
  if (on && !has) {
    if (w.addresses.length >= MAX_WATCHED) return { ok: false, message: `You can watch up to ${MAX_WATCHED} wallets.` };
    return { ok: true, list: { addresses: [...w.addresses, address], seen: w.seen } };
  }
  if (!on && has) {
    const { [address]: _gone, ...rest } = w.seen;
    void _gone;
    return { ok: true, list: { addresses: w.addresses.filter((a) => a !== address), seen: rest } };
  }
  return { ok: true, list: w };
}
