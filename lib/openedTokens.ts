/* Coins opened from search (or anywhere outside the Snipe and Scalp lists). The trade page finds its coin here when the live lists
   do not carry it, so any coin on Solana can be pulled up, charted and traded exactly like one clicked from a list. */
import type { Token } from "./types.ts";

const opened = new Map<string, Token>();

export function rememberToken(t: Token): void {
  opened.set(t.id, t);
  if (opened.size > 60) opened.delete(opened.keys().next().value as string);
}

export const openedToken = (id: string | null): Token | undefined => (id ? opened.get(id) : undefined);
