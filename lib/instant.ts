/* Instant mode: a button click on the site becomes an "intent" that the user's own agent picks up and executes with its own
   key, so no wallet prompt is needed. Pure helpers only; the endpoints do the storage and the CLI does the signing.
   Safety comes from four layers: the agent's operator must allow the owner's wallet, the owner proves it with a signature,
   intents go stale after 60 s, and the agent still runs every trade through the same guards and caps as any other. */

import { COIN_TYPE } from "./feeds.ts";

export type IntentStatus = "pending" | "claimed" | "done" | "failed";
export interface Intent {
  id: string;
  owner: string;
  side: "buy" | "sell";
  coin: string;
  /** decimal string; for a sell, "all" or "NN%" until the agent claims it and it becomes the exact amount */
  amount: string;
  status: IntentStatus;
  ts: number;
  digest?: string;
  note?: string;
}
export interface InstantSession { owner: string; agentId: string; exp: number }

export const STALE_MS = 60_000;
export const MAX_PENDING = 10;
export const MAX_QUEUE = 40;
export const MAX_BUY_SOL = 10_000;

const DEC = /^\d{1,12}(\.\d{1,9})?$/;

export function validateIntent(b: unknown): { ok: true; side: "buy" | "sell"; coin: string; amount: string } | { ok: false; error: string } {
  if (!b || typeof b !== "object") return { ok: false, error: "bad request" };
  const r = b as Record<string, unknown>;
  if (r.side !== "buy" && r.side !== "sell") return { ok: false, error: "side must be buy or sell" };
  if (typeof r.coin !== "string" || !COIN_TYPE.test(r.coin) || r.coin.length > 300) return { ok: false, error: "coin must be a full coin type" };
  const amount = typeof r.amount === "string" ? r.amount : "";
  if (r.side === "sell" && (amount === "all" || /^([1-9][0-9]?|100)%$/.test(amount))) return { ok: true, side: "sell", coin: r.coin, amount };
  if (!DEC.test(amount) || !(Number(amount) > 0)) return { ok: false, error: "amount must be a plain positive number" };
  if (r.side === "buy" && Number(amount) > MAX_BUY_SOL) return { ok: false, error: "amount is too large" };
  return { ok: true, side: r.side, coin: r.coin, amount };
}

/** The exact text the owner signs to start an instant session. */
export const enableMessage = (agentId: string, owner: string, exp: number) => `nimbros-instant:${agentId}:${owner}:${exp}`;

export function enableWindowOk(exp: unknown, now: number): exp is number {
  return typeof exp === "number" && Number.isFinite(exp) && exp > now && exp <= now + 25 * 3_600_000;
}

/** Adds an intent, or refuses when too many are already waiting. */
export function enqueue(queue: Intent[], i: Intent, now: number): { ok: true; queue: Intent[] } | { ok: false; error: string } {
  const live = queue.filter((x) => x.status === "pending" && now - x.ts <= STALE_MS);
  if (live.length >= MAX_PENDING) return { ok: false, error: "too many trades waiting for your agent" };
  return { ok: true, queue: [...queue, i].slice(-MAX_QUEUE) };
}

/** Marks stale pending intents failed and claims the fresh ones. Returns the updated queue and what the agent should run. */
export function claim(queue: Intent[], now: number): { queue: Intent[]; run: Intent[] } {
  const run: Intent[] = [];
  const next = queue.map((x) => {
    if (x.status !== "pending") return x;
    if (now - x.ts > STALE_MS) return { ...x, status: "failed" as const, note: "Expired: your agent wasn't listening in time." };
    const c = { ...x, status: "claimed" as const };
    run.push(c);
    return c;
  });
  return { queue: next, run };
}

export function finish(queue: Intent[], id: string, ok: boolean, digest?: string, note?: string): Intent[] {
  return queue.map((x) => (x.id === id && x.status === "claimed" ? { ...x, status: ok ? ("done" as const) : ("failed" as const), digest, note: note?.slice(0, 200) } : x));
}
