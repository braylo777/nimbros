import type { Change } from "./realPolicy.ts";
import { WSOL_MINT } from "./chain.ts";

/* Verdict on a simulated sale of a coin by one of its holders. Pure; the endpoint does the fetching. */

export type SellVerdict =
  | { verdict: "ok"; receivedPct: number; note: string }
  | { verdict: "taxed"; receivedPct: number; note: string }
  | { verdict: "blocked"; note: string }
  | { verdict: "inconclusive"; reason: string };

const GAS_ALLOWANCE = 5_000_000n; // 0.005 SOL: network + priority fees, added back so the sale is judged on what the swap paid
const BASE_TOLERANCE_BPS = 600; // router slippage and rounding

export function classifySell(a: {
  success: boolean;
  changes: Change[] | undefined;
  address: string;
  expectedOutRaw: bigint;
  coin: string;
  feeBps: number;
  holderSuiRaw?: bigint;
}): SellVerdict {
  if (a.holderSuiRaw !== undefined && a.holderSuiRaw < 20_000_000n) return { verdict: "inconclusive", reason: "The tested holder has too little SOL for fees." };
  if (!a.success) return { verdict: "blocked", note: "A holder with enough SOL for fees tried to sell in a dry run and it reverted. Sells may be blocked." };
  if (!a.changes) return { verdict: "inconclusive", reason: "The dry run returned no balance data." };
  const me = a.changes.filter((c) => c.address === a.address && c.coinType === WSOL_MINT);
  if (me.length === 0) return { verdict: "inconclusive", reason: "The dry run showed no SOL coming back." };
  const delta = me.reduce((s, c) => s + BigInt(c.amount), 0n);
  const received = delta + GAS_ALLOWANCE;
  if (a.expectedOutRaw <= 0n) return { verdict: "inconclusive", reason: "No quote to compare against." };
  const pct = Number((received * 10000n) / a.expectedOutRaw) / 100;
  const shortBps = Number(((a.expectedOutRaw - received) * 10000n) / a.expectedOutRaw);
  if (shortBps > BASE_TOLERANCE_BPS + a.feeBps) {
    return { verdict: "taxed", receivedPct: pct, note: `A test sale paid out ${pct.toFixed(1)}% of the quoted amount. Something is skimming the sale.` };
  }
  return { verdict: "ok", receivedPct: Math.min(pct, 100), note: `A holder's test sale went through and paid out ${Math.min(pct, 100).toFixed(1)}% of the quote.` };
}
