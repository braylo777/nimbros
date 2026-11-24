import { useSyncExternalStore } from "react";
import { normType } from "./tradingview.ts";

/* Who made a token. On Solana a coin has no publisher wallet we can read for free (launchpads mint through their own programs), so
   creators are only known where NimBros itself lists a coin with a verified agent name (see lib/launches.ts). The chip shows
   that agent name, else a shortened address. Nothing is guessed: a coin with no known creator simply has no creator chip. */

export interface Creator { address: string; name?: string }
export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** What the chip says for a creator. */
export function creatorLabel(c: Creator, agentByAddress: Record<string, string>): string {
  const agent = agentByAddress[c.address];
  if (agent) return `@${agent}`;
  if (c.name) return c.name;
  return shortAddr(c.address);
}

/* ---- browser store ---- */
const map: Record<string, Creator> = {};
const subs = new Set<() => void>();
export const useCreators = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => map, () => map);
export const creatorFor = (m: Record<string, Creator>, contract: string): Creator | undefined => m[normType(contract)];

/** Kept so callers have one code path: there is no chain source for creators on Solana, so this asks for nothing. */
export async function ensureCreators(coins: string[]): Promise<void> {
  void coins;
}
