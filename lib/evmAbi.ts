/* The little ABI encoding a launch needs: constructor(string name, string symbol, uint8 decimals, uint256 supplyWhole). No library, so it is small and testable. */
const hex = (n: bigint, bytes = 32): string => n.toString(16).padStart(bytes * 2, "0");
const pad = (s: string): string => s.padEnd(Math.ceil(s.length / 64) * 64, "0");
const utf8hex = (s: string): string => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join("");

function encodeString(s: string): string {
  const h = utf8hex(s);
  return hex(BigInt(h.length / 2)) + pad(h);
}

/** ABI-encoded constructor arguments, without a 0x prefix. */
export function encodeTokenArgs(name: string, symbol: string, decimals: number, supplyWhole: bigint): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("decimals out of range");
  if (supplyWhole < 0n || supplyWhole >= 2n ** 256n) throw new Error("supply out of range");
  const a = encodeString(name), b = encodeString(symbol);
  const head = 4 * 32;
  return hex(BigInt(head)) + hex(BigInt(head + a.length / 2)) + hex(BigInt(decimals)) + hex(supplyWhole) + a + b;
}

/** Deployment data: the contract's creation code followed by its constructor arguments. */
export const deployData = (bytecode: string, name: string, symbol: string, decimals: number, supplyWhole: bigint): string =>
  bytecode + encodeTokenArgs(name, symbol, decimals, supplyWhole);
