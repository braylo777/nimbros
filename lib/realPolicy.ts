import { WSOL_MINT, SOL_ADDRESS } from "./chain.ts";

/* Guard rails for REAL agent trades. PURE: no I/O, no clock. The server only ever builds an unsigned
   transaction; the agent signs with its own key. Every rule here fails closed. Off by default. */

export interface Caps { perTradeUsd: number; dailyUsd: number }
export const DEFAULT_CAPS: Caps = { perTradeUsd: 25, dailyUsd: 75 };
export const MIN_SLIPPAGE_BPS = 10;
export const MAX_SLIPPAGE_BPS = 300;
export const MIN_LIQUIDITY_USD = 10_000;
export const MAX_IMPACT_PCT = 3;
export const GAS_ALLOWANCE_RAW = 10_000_000n; // 0.01 SOL: the most a swap may spend on network fees, priority fees and new-token-account rent beyond the amount chosen
export const SOL_MINT = WSOL_MINT;

export interface RealConfig {
  enabled: boolean; // REAL_AGENT_TRADING=1
  killed: boolean;  // kill switch key present
  allow: Record<string, Caps>;
  /** Platform fee, in SOL, added to the same transaction as the swap and paid straight to the treasury, in basis points. 0 unless a treasury address is set. */
  feeBps: number;
  /** Company wallet the platform fee is paid to. Fee collection is off entirely when this is empty. */
  treasuryAddress: string;
}
export const MAX_FEE_BPS = 1000; // 10%: a hard ceiling on any configured platform fee

/* The published price list. Humans trade free; agents pay per filled trade. These are the numbers
   quoted to investors and to agents, so the code and the pitch can't drift apart. */
export const FEE_BPS = { spot: 15, copy: 4, perp: 3 } as const;
export type FeeKind = keyof typeof FEE_BPS;

const ADDR = SOL_ADDRESS;
const capNum = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1000 ? v : d);

/** Accepts `{"<wallet address>":{"perTradeUsd":25,"dailyUsd":75}}` or a comma list of addresses (default caps). Bad entries are dropped. */
export function parseAllowlist(raw: string | undefined): Record<string, Caps> {
  const out: Record<string, Caps> = {};
  if (!raw) return out;
  try {
    const j = JSON.parse(raw) as unknown;
    if (j && typeof j === "object" && !Array.isArray(j)) {
      for (const [k, v] of Object.entries(j as Record<string, Record<string, unknown>>)) {
        const a = k;
        if (ADDR.test(a)) out[a] = { perTradeUsd: capNum(v?.perTradeUsd, DEFAULT_CAPS.perTradeUsd), dailyUsd: capNum(v?.dailyUsd, DEFAULT_CAPS.dailyUsd) };
      }
      return out;
    }
  } catch { /* fall through to the comma list */ }
  for (const p of raw.split(",")) {
    const a = p.trim();
    if (ADDR.test(a)) out[a] = { ...DEFAULT_CAPS };
  }
  return out;
}

export type PolicyCode = "OFF" | "KILLED" | "NOT_ALLOWED" | "NOT_LINKED" | "OVER_TRADE_CAP" | "OVER_DAILY_CAP" | "BAD_AMOUNT";
export type Verdict<T = object> = ({ ok: true } & T) | { ok: false; code: string; message: string };
const no = (code: string, message: string): { ok: false; code: string; message: string } => ({ ok: false, code, message });

export function checkRealPolicy(a: {
  cfg: RealConfig; address: string; linkedWallet: string | undefined; usd: number; spentUsd24h: number;
}): Verdict<{ caps: Caps }> {
  const addr = a.address;
  if (!a.cfg.enabled) return no("OFF", "Real trading is switched off.");
  if (a.cfg.killed) return no("KILLED", "Real trading is paused.");
  const caps = a.cfg.allow[addr];
  if (!caps) return no("NOT_ALLOWED", "This address is not approved for real trading.");
  if (a.linkedWallet !== addr) return no("NOT_LINKED", "Link this wallet to your agent first (link_wallet).");
  if (!(a.usd > 0) || !Number.isFinite(a.usd)) return no("BAD_AMOUNT", "Enter a valid amount.");
  if (a.usd > caps.perTradeUsd + 1e-9) return no("OVER_TRADE_CAP", `Over the $${caps.perTradeUsd} per-trade cap.`);
  if (a.spentUsd24h + a.usd > caps.dailyUsd + 1e-9) return no("OVER_DAILY_CAP", `Over the $${caps.dailyUsd} 24-hour cap ($${a.spentUsd24h.toFixed(2)} used).`);
  return { ok: true, caps };
}

/** Human decimal ("1.5") to raw integer units. null for anything that isn't a plain positive number. */
export function toRaw(text: unknown, decimals: number): bigint | null {
  const t = typeof text === "number" ? String(text) : text;
  if (typeof t !== "string" || !/^\d{1,18}(\.\d{1,18})?$/.test(t)) return null;
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  const v = BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  return v > 0n ? v : null;
}

export const clampSlippage = (bps: unknown): number => {
  const n = typeof bps === "number" && Number.isFinite(bps) ? Math.round(bps) : 100;
  return Math.min(MAX_SLIPPAGE_BPS, Math.max(MIN_SLIPPAGE_BPS, n));
};
/** Floor, never round up: the wallet is guaranteed at least this much. */
export const minOutFor = (amountOut: bigint, bps: number): bigint => (amountOut * BigInt(10_000 - bps)) / 10_000n;

/* ---- simulation guard ---- */
export interface Change { coinType: string; address: string; amount: string }
const same = (a: string, b: string) => normCoin(a) === normCoin(b);
/** base58 mints are case-sensitive: the trimmed string is the canonical form */
export const normCoin = (t: string): string => t.trim();

export function checkSwapSim(a: {
  success: boolean; changes: Change[] | undefined; address: string;
  spendCoin: string; spendRaw: bigint; receiveCoin: string; minOutRaw: bigint;
}): Verdict<{ spentRaw: bigint; receivedRaw: bigint; gasRaw: bigint }> {
  if (!a.success) return no("SIM_FAILED", "The simulation failed. Nothing was sent.");
  if (!a.changes) return no("NO_DATA", "Simulation returned no balance data. Not signing.");
  const me = a.changes.filter((c) => c.address === a.address && BigInt(c.amount) !== 0n);
  const spend = me.filter((c) => same(c.coinType, a.spendCoin));
  const recv = me.filter((c) => same(c.coinType, a.receiveCoin));
  const other = me.filter((c) => !same(c.coinType, a.spendCoin) && !same(c.coinType, a.receiveCoin));
  const spendIsSol = same(a.spendCoin, SOL_MINT);
  if (other.length > 0) {
    // the only other movement allowed is the network fee, in SOL
    const onlyGas = other.every((c) => same(c.coinType, SOL_MINT) && BigInt(c.amount) < 0n && -BigInt(c.amount) <= GAS_ALLOWANCE_RAW);
    if (!onlyGas || spendIsSol) return no("UNEXPECTED_ASSET", "The swap would move another asset. Not signing.");
  }
  if (recv.length !== 1 || BigInt(recv[0].amount) <= 0n) return no("NO_RECEIVE", "The swap would not deliver the coin you asked for. Not signing.");
  const receivedRaw = BigInt(recv[0].amount);
  if (receivedRaw < a.minOutRaw) return no("UNDERDELIVERY", "The swap would deliver less than your minimum. Not signing.");
  const spendDelta = spend.length ? BigInt(spend[0].amount) : 0n;
  if (spendDelta >= 0n) return no("UNEXPECTED_DIRECTION", "The traded coin would not decrease. Not signing.");
  const spentRaw = -spendDelta;
  const gasSol = other.filter((c) => same(c.coinType, SOL_MINT)).reduce((s, c) => s - BigInt(c.amount), 0n);
  if (spendIsSol) {
    // SOL out = amount + network fees, less any rent handed back when a temporary wrapped-SOL account is closed. Spending a little LESS than chosen is
    // therefore normal on Solana; spending more than the amount plus the fee allowance is not.
    const fee = spentRaw - a.spendRaw;
    if (fee > GAS_ALLOWANCE_RAW) return no("OVERSPEND", "The swap would spend more SOL than you chose. Not signing.");
    return { ok: true, spentRaw: spentRaw < a.spendRaw ? spentRaw : a.spendRaw, receivedRaw, gasRaw: fee > 0n ? fee : 0n };
  }
  if (spentRaw > a.spendRaw) return no("OVERSPEND", "The swap would spend more than you chose. Not signing.");
  return { ok: true, spentRaw, receivedRaw, gasRaw: gasSol };
}

/* ---- coin safety gate (for buys) ---- */
export interface GateInput {
  liquidityUsd: number;
  impactPct: number;
  mint: "good" | "warn" | "unknown";
  allowUnlockedMint?: boolean;
}
export function safetyGate(g: GateInput): Verdict {
  if (!(g.liquidityUsd >= MIN_LIQUIDITY_USD)) return no("THIN_POOL", `Pool liquidity is under $${MIN_LIQUIDITY_USD.toLocaleString()}.`);
  if (!(g.impactPct <= MAX_IMPACT_PCT)) return no("HIGH_IMPACT", `This trade would move the price over ${MAX_IMPACT_PCT}%.`);
  if (g.mint !== "good" && !g.allowUnlockedMint) return no("MINT_NOT_LOCKED", "The coin's minting is not locked, or could not be checked.");
  return { ok: true };
}
