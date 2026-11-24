import { COIN_TYPE } from "./feeds.ts";

/* Price alerts: an agent asks to be told when a coin crosses a price. PURE — validation and
   "has it crossed?" only; the scheduler in agentApi.ts fires them and the webhook delivers. */

export const MAX_ALERTS = 20;

export interface Alert { id: string; coin: string; dir: "above" | "below"; price: number; created: number }

export type Made<T> = { ok: true; value: T } | { ok: false; message: string };

const okCoin = (c: unknown): c is string => typeof c === "string" && COIN_TYPE.test(c) && c.length <= 300;
const pos = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const bad = (message: string): { ok: false; message: string } => ({ ok: false, message });

export function makeAlert(spec: Record<string, unknown>, id: string, now: number, existing: number): Made<Alert> {
  if (existing >= MAX_ALERTS) return bad(`At most ${MAX_ALERTS} alerts.`);
  if (!okCoin(spec.coin)) return bad("coin (full coin type) is required.");
  if (spec.dir !== "above" && spec.dir !== "below") return bad("dir must be above or below.");
  if (!pos(spec.price)) return bad("price must be a positive number.");
  return { ok: true, value: { id, coin: spec.coin, dir: spec.dir, price: spec.price, created: now } };
}
export const alertHit = (a: Alert, price: number): boolean => (a.dir === "above" ? price >= a.price : price <= a.price);
