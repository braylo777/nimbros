import { useSyncExternalStore } from "react";

/* The numbers on the Quick trade buttons (SOL to buy, percent to sell). Editable by the user, remembered in this browser. */

export interface QuickPresets { buy: number[]; sell: number[] }
export const DEFAULT_PRESETS: QuickPresets = { buy: [0.1, 0.5, 1], sell: [100, 50, 25, 10] };
export const MAX_BUY_SOL = 1_000;

/** A buy size: more than 0, at most 1,000 SOL, up to 9 decimals. Returns the number, or null. */
export function parseBuy(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,4}(\.\d{1,9})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= MAX_BUY_SOL ? n : null;
}
/** A sell share: a whole percent from 1 to 100. */
export function parseSell(text: string): number | null {
  const t = text.trim().replace(/%$/, "");
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 100 ? n : null;
}

export function cleanPresets(raw: unknown): QuickPresets {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (v: unknown, def: number[], ok: (n: number) => boolean) =>
    Array.isArray(v) && v.length === def.length && v.every((x) => typeof x === "number" && ok(x)) ? (v as number[]) : def;
  return {
    buy: pick(r.buy, DEFAULT_PRESETS.buy, (n) => parseBuy(String(n)) !== null),
    sell: pick(r.sell, DEFAULT_PRESETS.sell, (n) => Number.isInteger(n) && n >= 1 && n <= 100),
  };
}

const KEY = "nb_qt_presets";
let cur: QuickPresets = DEFAULT_PRESETS;
let hydrated = false;
const subs = new Set<() => void>();

const hydrate = () => {
  if (hydrated || typeof localStorage === "undefined") return;
  hydrated = true;
  try { cur = cleanPresets(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { cur = DEFAULT_PRESETS; }
};

function save(next: QuickPresets) {
  cur = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* kept for this session */ }
  subs.forEach((s) => s());
}
export const setBuyPreset = (i: number, v: number) => { hydrate(); save({ ...cur, buy: cur.buy.map((x, j) => (j === i ? v : x)) }); };
export const setSellPreset = (i: number, v: number) => { hydrate(); save({ ...cur, sell: cur.sell.map((x, j) => (j === i ? v : x)) }); };

export const useQuickPresets = (): QuickPresets =>
  useSyncExternalStore((f) => { hydrate(); subs.add(f); return () => subs.delete(f); }, () => { hydrate(); return cur; }, () => DEFAULT_PRESETS);
