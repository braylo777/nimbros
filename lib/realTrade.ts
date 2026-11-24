import { COIN_TYPE } from "./feeds.ts";
import { checkRealPolicy, checkSwapSim, clampSlippage, GAS_ALLOWANCE_RAW, minOutFor, normCoin, safetyGate, SOL_MINT, toRaw, type Change, type RealConfig } from "./realPolicy.ts";
import { isSolAddress } from "./chain.ts";
import type { Ledger } from "./realLedger.ts";

/* Plans one REAL swap for an agent: policy -> price and size -> coin safety -> quote -> build -> simulate.
   The result is an UNSIGNED transaction. Nothing here signs or sends anything. Dependencies are injected
   so the whole decision path can be tested without a network. */

export interface Agent { id: string; wallet?: string }
export interface QuoteResult { amountOut: bigint; amountIn: bigint; insufficient: boolean; router: unknown }
export interface Deps {
  cfg: RealConfig;
  ledger: Ledger;
  now: () => number;
  rand: () => string;
  solUsd: () => Promise<number | null>;
  market: (coin: string) => Promise<{ price: number; liquidityUsd: number } | null>;
  decimals: (coin: string) => Promise<number | null>;
  mint: (coin: string) => Promise<"good" | "warn" | "unknown">;
  /** a verified, long-standing coin (its mint is held by its team or a DAO, so "locked" is the wrong test) */
  established: (coin: string) => boolean;
  quote: (from: string, target: string, amountRaw: bigint, slippage: number) => Promise<QuoteResult | null>;
  buildAndSimulate: (router: unknown, address: string, slippage: number) => Promise<{ tx: string; bytes: string; success: boolean; changes: Change[] | undefined }>;
}
export interface TradeReq { side?: unknown; coin?: unknown; amount?: unknown; address?: unknown; slippageBps?: unknown }
export type Plan =
  | { ok: true; tx: string; txBytes: string; side: "buy" | "sell"; coin: string; spendCoin: string; receiveCoin: string; spendDecimals: number; receiveDecimals: number; spend: string; receive: string; expectedOutRaw: string; minOutRaw: string; usd: number; impactPct: number; gasRaw: string; reserveId: string; guards: string[]; feeBps: number }
  | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): Plan => ({ ok: false, status, code, message });

/**
 * The swap itself: validate, price, route, check the coin is safe to touch, build and simulate.
 * Knows nothing about agents, caps or ledgers — a connected human wallet and an agent both come
 * through here, so they are protected by exactly the same guards.
 * `onSized` runs once the dollar size is known, which is where the agent path applies its caps.
 */
export async function planSwap(
  d: Deps,
  r: TradeReq,
  onSized?: (a: { address: string; usd: number }) => Promise<{ ok: true } | { ok: false; status: number; code: string; message: string }>
): Promise<Plan> {
  if (r.side !== "buy" && r.side !== "sell") return fail(400, "BAD_REQUEST", "side must be buy or sell.");
  if (typeof r.coin !== "string" || !COIN_TYPE.test(r.coin) || r.coin.length > 300) return fail(400, "BAD_REQUEST", "coin must be a Solana token mint address.");
  if (normCoin(r.coin) === normCoin(SOL_MINT)) return fail(422, "BAD_COIN", "Trade a coin against SOL, not SOL itself.");
  const address = typeof r.address === "string" ? r.address : "";
  if (!isSolAddress(address)) return fail(400, "BAD_REQUEST", "address must be a Solana wallet address.");
  const side = r.side, coin = r.coin;

  if (!d.cfg.enabled) return fail(503, "OFF", "Real trading is switched off.");
  if (d.cfg.killed) return fail(503, "KILLED", "Real trading is paused.");

  const [solPrice, mkt, dec] = await Promise.all([d.solUsd(), d.market(coin), d.decimals(coin)]);
  if (!solPrice || !mkt || !(mkt.price > 0) || dec === null) return fail(422, "NO_PRICE", "No live price for that coin.");
  const spendCoin = side === "buy" ? SOL_MINT : coin;
  const receiveCoin = side === "buy" ? coin : SOL_MINT;
  const spendDec = side === "buy" ? 9 : dec, recvDec = side === "buy" ? dec : 9;
  const spendRaw = toRaw(r.amount, spendDec);
  if (spendRaw === null) return fail(400, "BAD_AMOUNT", `amount must be a plain positive number with at most ${spendDec} decimals.`);
  const spendUnits = Number(spendRaw) / 10 ** spendDec;
  const usd = side === "buy" ? spendUnits * solPrice : spendUnits * mkt.price;

  const sized = onSized ? await onSized({ address, usd }) : { ok: true as const };
  if (!sized.ok) return fail(sized.status, sized.code, sized.message);

  const bps = clampSlippage(r.slippageBps);
  const q = await d.quote(spendCoin, receiveCoin, spendRaw, bps / 10_000);
  if (!q || q.insufficient || q.amountOut <= 0n) return fail(422, "NO_ROUTE", "No route with enough liquidity for that trade.");

  const outUnits = Number(q.amountOut) / 10 ** recvDec;
  const outUsd = side === "buy" ? outUnits * mkt.price : outUnits * solPrice;
  const impactPct = Math.max(0, ((usd - outUsd) / usd) * 100);
  const est = d.established(coin);
  const gate = safetyGate({ liquidityUsd: side === "buy" ? mkt.liquidityUsd : Infinity, impactPct, mint: side === "buy" && !est ? await d.mint(coin) : "good" });
  if (!gate.ok) return fail(422, gate.code, gate.message);

  const minOutRaw = minOutFor(q.amountOut, bps);
  let built: Awaited<ReturnType<Deps["buildAndSimulate"]>>;
  try {
    built = await d.buildAndSimulate(q.router, address, bps / 10_000);
  } catch (e) {
    // "no funds" is by far the commonest failure here, and the SDK words it several ways
    const msg = String((e as Error)?.message ?? "");
    const broke = /insufficient|no valid coins|not enough|balance/i.test(msg);
    return fail(422, "BUILD_FAILED", broke ? "This wallet doesn't hold enough to make that trade." : "Couldn't build that swap right now.");
  }
  /* Selling for SOL: what lands in the wallet is the swap output minus the platform fee and network fees, so the
     simulation is held to that (the swap itself enforces minOutRaw on-chain). Everything else is held exactly. */
  const feeRaw = side === "sell" ? (minOutRaw * BigInt(d.cfg.feeBps)) / 10_000n : 0n;
  const simMin = side === "sell" ? (() => { const m = minOutRaw - feeRaw - GAS_ALLOWANCE_RAW; return m > 1n ? m : 1n; })() : minOutRaw;
  const sim = checkSwapSim({ success: built.success, changes: built.changes, address, spendCoin, spendRaw, receiveCoin, minOutRaw: simMin });
  if (!sim.ok) return fail(422, sim.code, sim.message);

  return {
    ok: true, tx: built.tx, txBytes: built.bytes, side, coin, spendCoin, receiveCoin, spendDecimals: spendDec, receiveDecimals: recvDec, spend: spendRaw.toString(), receive: sim.receivedRaw.toString(), expectedOutRaw: q.amountOut.toString(), minOutRaw: minOutRaw.toString(),
    usd, impactPct, gasRaw: sim.gasRaw.toString(), reserveId: "",
    guards: ["price", "coin safety", "route", "simulation"],
    feeBps: d.cfg.feeBps,
  };
}

/** An agent's real trade: the same swap, plus the allowlist, the linked wallet and the rolling caps. */
export async function planTrade(d: Deps, agent: Agent, r: TradeReq): Promise<Plan> {
  const plan = await planSwap(d, r, async ({ address, usd }) => {
    // cheap gates first, then the caps once the dollar size is known
    const pre = checkRealPolicy({ cfg: d.cfg, address, linkedWallet: agent.wallet, usd: 0.01, spentUsd24h: 0 });
    if (!pre.ok) return { ok: false, status: pre.code === "OFF" || pre.code === "KILLED" ? 503 : 403, code: pre.code, message: pre.message };
    const spent = await d.ledger.spentUsd(address, d.now() - 86_400_000);
    const full = checkRealPolicy({ cfg: d.cfg, address, linkedWallet: agent.wallet, usd, spentUsd24h: spent });
    return full.ok ? { ok: true } : { ok: false, status: 403, code: full.code, message: full.message };
  });
  if (!plan.ok) return plan;

  const reserveId = d.rand().slice(0, 12);
  await d.ledger.add({ id: reserveId, ts: d.now(), agentId: agent.id, address: r.address as string, kind: "reserve", usd: plan.usd, detail: { side: plan.side, coin: plan.coin, spendRaw: plan.spend, minOutRaw: plan.minOutRaw, impactPct: plan.impactPct } });
  return { ...plan, reserveId, guards: ["policy", ...plan.guards] };
}
