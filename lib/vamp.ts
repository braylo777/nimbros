import type { Token } from "./types.ts";

/* "Vamps": newer coins that copy an established one's ticker or name to siphon its volume.
   A coin is a vamp of `tok` when it shares the ticker or name (case/space-insensitive), has a different
   contract, and is younger than `tok`. Only coins in the live feeds are compared, so this is a floor, not a census. */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function findVamps(tok: Token, all: Token[]): Token[] {
  const t = norm(tok.ticker), n = norm(tok.name);
  const age = (x: Token) => x.ageMin ?? Infinity;
  return all.filter(
    (o) =>
      o.contract !== tok.contract &&
      ((t.length >= 2 && norm(o.ticker) === t) || (n.length >= 3 && norm(o.name) === n)) &&
      age(o) < age(tok),
  );
}

/** Copies of the same ticker/name that are OLDER than this coin: this coin may itself be the vamp. */
export function findOriginals(tok: Token, all: Token[]): Token[] {
  const t = norm(tok.ticker), n = norm(tok.name);
  const age = (x: Token) => x.ageMin ?? Infinity;
  return all.filter(
    (o) =>
      o.contract !== tok.contract &&
      ((t.length >= 2 && norm(o.ticker) === t) || (n.length >= 3 && norm(o.name) === n)) &&
      age(o) > age(tok) &&
      o.liquidity > tok.liquidity,
  );
}
