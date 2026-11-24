import { COIN_TYPE } from "./feeds.ts";
import type { MintInfo } from "./solRpc.ts";

/* On-chain token safety checks, read from the mint account itself. Only facts we can actually read:
   whether the mint authority is revoked (nobody can print more), whether the freeze authority is revoked
   (nobody can lock your tokens) and the current supply. What we can't read is reported as "unknown",
   never as safe. */

export type Level = "good" | "warn" | "unknown";
export interface Check { key: "mint" | "freeze" | "supply"; label: string; level: Level; detail: string }
export interface Safety { coinType: string; checks: Check[] }

export function fmtSupply(raw: string, decimals: number): string {
  try {
    const whole = BigInt(raw) / 10n ** BigInt(decimals);
    return whole.toLocaleString("en-US");
  } catch {
    return "unknown";
  }
}

export function summarizeSafety(coinType: string, info: MintInfo | null): Safety | null {
  if (!COIN_TYPE.test(coinType)) return null;
  if (!info) {
    const unknown = (key: Check["key"], label: string): Check => ({ key, label, level: "unknown", detail: "Couldn't read." });
    return { coinType, checks: [unknown("mint", "Minting"), unknown("freeze", "Freezing"), unknown("supply", "Total supply")] };
  }
  const mint: Check = info.mintAuthority === null
    ? { key: "mint", label: "Minting", level: "good", detail: "Revoked. No more can be created." }
    : { key: "mint", label: "Minting", level: "warn", detail: "A wallet or program still holds the mint authority and can create more." };
  const freeze: Check = info.freezeAuthority === null
    ? { key: "freeze", label: "Freezing", level: "good", detail: "Revoked. Nobody can freeze your tokens." }
    : { key: "freeze", label: "Freezing", level: "warn", detail: "A freeze authority exists and can lock token accounts." };
  const supply: Check = /^\d+$/.test(info.supply) && info.supply !== "0"
    ? { key: "supply", label: "Total supply", level: "unknown", detail: `${fmtSupply(info.supply, info.decimals)} coins.` }
    : { key: "supply", label: "Total supply", level: "unknown", detail: "Couldn't read." };
  return { coinType, checks: [mint, freeze, supply] };
}
