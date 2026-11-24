/* Agent bonding and slashing. PURE, integer-only.

   An agent posts a $NMBR bond before it may trade real money. The bond is sized to cover one day of
   damage at that agent's own daily cap, so a bigger limit costs a bigger bond. Breaking a rule slashes
   the bond into the insurance fund.

   $NMBR does not exist yet, so this is off unless a bond token is configured (see `bondGate`). It is
   written and tested now so that turning it on later is a config change, not a rewrite. */

/** Bond must cover this many days of trading at the agent's own daily cap. */
export const COVERAGE_DAYS = 1;

/** What each rule break costs, as a share of the posted bond. */
export const SLASH_BPS = {
  /** Sent a transaction that doesn't match the one it was quoted — the worst case, takes everything. */
  SIM_MISMATCH: 10_000,
  /** Traded while real trading was paused platform-wide. */
  KILL_IGNORED: 10_000,
  /** Traded against itself to manufacture volume. */
  WASH: 5_000,
  /** Repeatedly tried to push past its caps. */
  CAP_BREACH: 2_500,
} as const;

export type SlashReason = keyof typeof SLASH_BPS;

export interface BondState {
  /** raw $NMBR units currently posted */
  postedRaw: bigint;
  /** raw $NMBR units taken from this agent so far */
  slashedRaw: bigint;
}

export const emptyBond = (): BondState => ({ postedRaw: 0n, slashedRaw: 0n });

/**
 * Raw $NMBR units an agent must post to trade at `dailyUsdCap`.
 * Returns null when the token price isn't known — the caller must then refuse to trade rather than
 * guess a bond, so a missing price can never mean "no bond needed".
 */
export function requiredBondRaw(dailyUsdCap: number, nmbrUsd: number | null, decimals: number): bigint | null {
  if (!Number.isFinite(dailyUsdCap) || dailyUsdCap <= 0) return null;
  if (nmbrUsd === null || !Number.isFinite(nmbrUsd) || nmbrUsd <= 0) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 24) return null;
  const tokens = (dailyUsdCap * COVERAGE_DAYS) / nmbrUsd;
  // round up: a bond that is one unit short is not a bond
  return BigInt(Math.ceil(tokens * 10 ** decimals));
}

/** Takes the slash out of the posted bond, never more than what's actually posted. */
export function slash(state: BondState, reason: SlashReason): { state: BondState; toInsuranceRaw: bigint } {
  const share = BigInt(SLASH_BPS[reason]);
  const want = (state.postedRaw * share) / 10_000n;
  const take = want > state.postedRaw ? state.postedRaw : want;
  if (take <= 0n) return { state, toInsuranceRaw: 0n };
  return {
    state: { postedRaw: state.postedRaw - take, slashedRaw: state.slashedRaw + take },
    toInsuranceRaw: take,
  };
}

export type BondVerdict = { ok: true; requiredRaw: bigint } | { ok: false; code: string; message: string };

/**
 * Whether this agent may trade right now, bond-wise.
 * `bondToken` empty (the case today, with no $NMBR) means bonding isn't enforced at all.
 */
export function bondGate(a: {
  bondToken: string;
  dailyUsdCap: number;
  nmbrUsd: number | null;
  decimals: number;
  state: BondState;
}): BondVerdict {
  if (!a.bondToken) return { ok: true, requiredRaw: 0n }; // no token yet: bonding not enforced
  const need = requiredBondRaw(a.dailyUsdCap, a.nmbrUsd, a.decimals);
  if (need === null) return { ok: false, code: "NO_BOND_PRICE", message: "Can't price the $NMBR bond right now." };
  if (a.state.postedRaw < need) {
    return { ok: false, code: "BOND_TOO_SMALL", message: `Post a larger $NMBR bond to trade at this limit.` };
  }
  return { ok: true, requiredRaw: need };
}
