import type { Token } from "./types.ts";

/* A quick look from the numbers already on the row. It is a prompt to look closer, never a guarantee. */
export function quickCheck(t: Token): { level: "ok" | "care" | "risk"; why: string[] } {
  const risk: string[] = [], care: string[] = [];
  if (t.liquidity < 2_000) risk.push("very little liquidity: hard to sell");
  else if (t.liquidity < 10_000) care.push("thin liquidity");
  if (t.top10Pct !== undefined) { if (t.top10Pct > 80) risk.push("top 10 wallets hold over 80%"); else if (t.top10Pct > 50) care.push("top 10 wallets hold over 50%"); }
  if (t.bundlerPct !== undefined) { if (t.bundlerPct > 40) risk.push("many bundled buyers"); else if (t.bundlerPct > 20) care.push("some bundled buyers"); }
  if (t.hasSocial === false) care.push("no social links");
  return risk.length ? { level: "risk", why: risk } : care.length ? { level: "care", why: care } : { level: "ok", why: ["no red flags in the numbers we can see"] };
}

/** Just two words shown anywhere: a good-looking runner, or anything that needs a second look. The colour (green/amber/red) still
    carries how serious it is; the label stays simple either way. */
export const quickCheckLabel = (level: "ok" | "care" | "risk"): string => (level === "ok" ? "Runner" : "Caution");

