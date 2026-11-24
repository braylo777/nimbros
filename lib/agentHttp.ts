import { d1Store, type D1 } from "./accountStore.ts";
import { sha256, type Deps } from "./agentApi.ts";
import { bump } from "./counter.ts";
import { lookup, marks } from "./serverMarket.ts";
import { WSOL_MINT } from "./chain.ts";

interface KV { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> }
export interface Env { FEEDS?: KV; DB?: D1; CRON_SECRET?: string }
export const json = (b: unknown, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": cache } });

let solCache: { at: number; v: number | null } | null = null;
/** The SOL price in dollars, read at most once every 10 seconds per isolate. */
async function solUsdCached(): Promise<number | null> {
  if (solCache && Date.now() - solCache.at < 10_000 && solCache.v) return solCache.v;
  const v = (await marks([WSOL_MINT])).get(WSOL_MINT) ?? null;
  if (v) solCache = { at: Date.now(), v };
  return v ?? solCache?.v ?? null;
}

export function depsFrom(env: Env): Deps | null {
  if (!env.DB) return null;
  return {
    store: d1Store(env.DB),
    now: () => Date.now(),
    rand: () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join(""),
    lookup: (c) => lookup(c),
    marks: (cs) => marks(cs),
    solUsd: solUsdCached,
  };
}

/** A generic per-visitor-per-hour cap, hashed IP, D1-backed. Used to keep any single unauthenticated endpoint from being hammered
    by one address. If the limiter itself fails we let the request through: a broken counter must never block a real user. */
export async function rateLimited(env: Env, request: Request, bucket: string, maxPerHour: number, now = Date.now()): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const ip = request.headers.get("cf-connecting-ip") ?? "local";
    const n = await bump(env.DB, `${bucket}:${(await sha256(ip)).slice(0, 24)}`, 3_600_000, now);
    return n > maxPerHour;
  } catch {
    return false;
  }
}

/** At most 5 registrations per visitor per hour (hashed, never stored raw). If the limiter itself fails we let the request through: a broken counter must never block a real agent. */
export async function registrationAllowed(env: Env, request: Request, now = Date.now()): Promise<boolean> {
  if (!env.DB) return true;
  try {
    const ip = request.headers.get("cf-connecting-ip") ?? "local";
    const n = await bump(env.DB, `regip:${(await sha256(ip)).slice(0, 24)}`, 3_600_000, now);
    return n <= 5;
  } catch {
    return true;
  }
}
