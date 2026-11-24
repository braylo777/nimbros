/* Decimal-string <-> raw-integer conversion with NO floating point.
   parseFloat("30.8") * 1e9 is where money bugs hide; this never does that. */

/**
 * "1.5" + 9 decimals -> 1_500_000_000n. Returns null for anything that isn't a
 * plain non-negative decimal, or that has more fractional digits than the coin
 * supports (we refuse rather than silently truncate a user's amount).
 */
export function parseUnits(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [whole = "", frac = ""] = t.split(".");
  if (frac.length > decimals) return null;
  const digits = (whole || "0") + frac.padEnd(decimals, "0");
  return BigInt(digits);
}

/** 1_500_000_000n, 9 -> "1.5". Trims trailing zeros; keeps at most `maxFrac` fractional digits (truncates, for display only). */
export function formatUnits(raw: bigint, decimals: number, maxFrac = decimals): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = (abs % base).toString().padStart(decimals, "0").slice(0, Math.max(0, maxFrac));
  frac = frac.replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}
