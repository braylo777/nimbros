import { useSyncExternalStore } from "react";

/* The one-click buy size (in SOL) shared by every list card. Remembered in this browser. */

export const QUICK_AMOUNTS = [0.005, 0.1, 0.5, 1] as const; // 0.005 is a test size: small enough to try a real trade with pocket change
const KEY = "nb_quick_sol";
let cur = 0.1;
let hydrated = false;
const subs = new Set<() => void>();

const hydrate = () => {
  if (hydrated || typeof localStorage === "undefined") return;
  hydrated = true;
  try {
    const v = Number(localStorage.getItem(KEY));
    if ((QUICK_AMOUNTS as readonly number[]).includes(v)) cur = v;
  } catch { /* storage blocked: default */ }
};

export function setQuickAmount(v: number): void {
  cur = v;
  try { localStorage.setItem(KEY, String(v)); } catch { /* fine */ }
  subs.forEach((s) => s());
}

export const useQuickAmount = (): number =>
  useSyncExternalStore((f) => { hydrate(); subs.add(f); return () => subs.delete(f); }, () => { hydrate(); return cur; }, () => 0.1);
