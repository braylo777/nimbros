/* Solana constants and address rules, shared by the browser, the Pages functions and the tests.
   Pure: no I/O, no SDK import. Addresses and mints are base58 and CASE-SENSITIVE — never lowercase them. */

export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000;
/** Wrapped SOL: the mint every SOL-quoted pool and every Jupiter route uses for native SOL. */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNyFZqhaUaPRRp6B7";

const B58 = "[1-9A-HJ-NP-Za-km-z]";
/** A base58 public key (wallet, mint or pool address): 32-44 characters. */
export const SOL_ADDRESS = new RegExp(`^${B58}{32,44}$`);
export const isSolAddress = (s: unknown): s is string => typeof s === "string" && SOL_ADDRESS.test(s);

/** lamports -> SOL as a float, for DISPLAY only. */
export const lamportsToSol = (l: string | bigint | number): number => Number(l) / LAMPORTS_PER_SOL;

/** Where a mint / pool / wallet / tx can be looked at. */
export const solscanToken = (mint: string) => `https://solscan.io/token/${mint}`;
export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}`;
export const solscanAccount = (a: string) => `https://solscan.io/account/${a}`;

/** Launchpads NimBros indexes. `dex` ids are the GeckoTerminal / DexScreener dexId strings (lowercase). */
export interface Launchpad { id: string; name: string; url: string; dex: string[]; blurb: string }
export const LAUNCHPADS: Launchpad[] = [
  { id: "pumpfun", name: "pump.fun", url: "https://pump.fun", dex: ["pump-fun", "pumpfun", "pumpswap"], blurb: "The original Solana bonding-curve launchpad." },
  { id: "bonk", name: "bonk.fun", url: "https://bonk.fun", dex: ["bonk", "letsbonk", "raydium-launchlab", "launchlab"], blurb: "LetsBonk launchpad on Raydium LaunchLab." },
  { id: "moonshot", name: "Moonshot", url: "https://moonshot.com", dex: ["moonshot"], blurb: "DEXScreener's mobile-first launchpad." },
  { id: "meteora", name: "Meteora DBC", url: "https://meteora.ag", dex: ["meteora", "meteora-dbc", "meteora-damm-v2"], blurb: "Dynamic bonding curve launches (Believe, Jupiter Studio)." },
  { id: "raydium", name: "Raydium", url: "https://raydium.io", dex: ["raydium", "raydium-clmm", "raydium-cp"], blurb: "Graduated pools and direct Raydium listings." },
  { id: "orca", name: "Orca", url: "https://orca.so", dex: ["orca", "whirlpool"], blurb: "Whirlpool concentrated-liquidity pools." },
];

/** Which launchpad a pool's dex id belongs to, or undefined for anything not indexed. */
export function launchpadOf(dex: string | undefined): Launchpad | undefined {
  if (!dex) return undefined;
  const d = dex.toLowerCase();
  return LAUNCHPADS.find((l) => l.dex.some((x) => d === x || d.includes(x)));
}
