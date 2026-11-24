/* Where a platform fee goes once it's collected. PURE, integer-only: fees arrive as raw on-chain
   units, so every split is done in bigint and the parts always add back up to the whole. The
   remainder from integer division goes to the buyback bucket rather than being dropped. */

export const SPLIT_BPS = {
  buyback: 4000,   // 40% — buy $NMBR on the open market
  insurance: 3000, // 30% — the fund that covers slashed-agent damage
  treasury: 1500,  // 15% — operating treasury
  builders: 1000,  // 10% — builder grants
  solana: 500,     //  5% — back to the Solana ecosystem
} as const;

export type SplitKey = keyof typeof SPLIT_BPS;
export type FeeSplit = Record<SplitKey, bigint>;

/** Every bucket except buyback rounds down; buyback takes the remainder, so the sum is exact. */
export function splitFee(totalRaw: bigint): FeeSplit {
  if (totalRaw <= 0n) return { buyback: 0n, insurance: 0n, treasury: 0n, builders: 0n, solana: 0n };
  const insurance = (totalRaw * BigInt(SPLIT_BPS.insurance)) / 10_000n;
  const treasury = (totalRaw * BigInt(SPLIT_BPS.treasury)) / 10_000n;
  const builders = (totalRaw * BigInt(SPLIT_BPS.builders)) / 10_000n;
  const solana = (totalRaw * BigInt(SPLIT_BPS.solana)) / 10_000n;
  return { buyback: totalRaw - insurance - treasury - builders - solana, insurance, treasury, builders, solana };
}

/** The fee itself, taken out of a filled trade's notional. Floors: never charge more than the rate. */
export function feeOn(notionalRaw: bigint, bps: number): bigint {
  if (notionalRaw <= 0n || !Number.isFinite(bps) || bps <= 0) return 0n;
  return (notionalRaw * BigInt(Math.floor(bps))) / 10_000n;
}

export const sumSplit = (s: FeeSplit): bigint => s.buyback + s.insurance + s.treasury + s.builders + s.solana;
