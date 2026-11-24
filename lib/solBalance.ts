"use client";

import { PublicKey } from "@solana/web3.js";
import { getConnection } from "./solana.ts";

/** How much of a token (raw units) a wallet holds, summed over all of its token accounts for that mint. Read from chain, never assumed. */
export async function tokenBalanceRaw(owner: string, mint: string): Promise<bigint> {
  const r = await getConnection().getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }, "confirmed");
  return r.value.reduce((s, a) => s + BigInt((a.account.data.parsed as { info: { tokenAmount: { amount: string } } }).info.tokenAmount.amount), 0n);
}
