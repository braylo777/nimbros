import { PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, AddressLookupTableAccount } from "@solana/web3.js";
import { WSOL_MINT, isSolAddress } from "./chain.ts";
import { d1Ledger } from "./realLedger.ts";
import { FEE_BPS, MAX_FEE_BPS, parseAllowlist, type Change, type RealConfig } from "./realPolicy.ts";
import type { Deps } from "./realTrade.ts";
import { summarizeSafety } from "./safety.ts";
import { getMintInfo, rpc, type RpcEnv } from "./solRpc.ts";
import { lookup, marks } from "./serverMarket.ts";
import { tvSymbolFor } from "./tradingview.ts";
import type { Env as BaseEnv } from "./agentHttp.ts";

/* Wires the real-trading planner to the outside world: Jupiter quotes and instructions, Solana RPC reads and simulation. */

export interface RealEnv extends BaseEnv, RpcEnv { REAL_AGENT_TRADING?: string; AGENT_ALLOWLIST?: string; TREASURY_ADDRESS?: string; PLATFORM_FEE_BPS?: string; JUPITER_API_URL?: string; JUPITER_API_KEY?: string }

const JUP = "https://lite-api.jup.ag/swap/v1";
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** Jupiter chooses the priority fee; this caps what it may spend (0.002 SOL), well inside the 0.01 SOL of network fees the guards allow. */
const MAX_PRIORITY_LAMPORTS = 2_000_000;

export async function realConfig(env: RealEnv): Promise<RealConfig> {
  let killed = false;
  try { killed = !!(await env.FEEDS?.get("killswitch")); } catch { killed = true; } // if the switch can't be read, assume it is pulled
  const treasuryAddress = isSolAddress(env.TREASURY_ADDRESS) ? env.TREASURY_ADDRESS : "";
  const feeRaw = Number(env.PLATFORM_FEE_BPS ?? FEE_BPS.spot); // the published agent spot rate
  const feeBps = treasuryAddress && Number.isFinite(feeRaw) && feeRaw > 0 ? Math.min(feeRaw, MAX_FEE_BPS) : 0;
  // approvals live in D1 so they can change without a redeploy; the env list still works and D1 rows win. If D1 can't be read, only the env list applies (fail closed).
  const allow = parseAllowlist(env.AGENT_ALLOWLIST);
  try {
    const rows = env.DB ? (await env.DB.prepare("SELECT address, per_trade_usd, daily_usd FROM approved_wallets").all<{ address: string; per_trade_usd: number; daily_usd: number }>()).results : [];
    for (const r of rows) if (isSolAddress(r.address)) allow[r.address] = { perTradeUsd: r.per_trade_usd, dailyUsd: r.daily_usd };
  } catch { /* fail closed */ }
  return { enabled: env.REAL_AGENT_TRADING === "1", killed, allow, feeBps, treasuryAddress };
}

interface JupQuote { inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct?: string; [k: string]: unknown }
interface JupIx { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }

const jupHeaders = (env: RealEnv): Record<string, string> => ({ "content-type": "application/json", ...(env.JUPITER_API_KEY ? { "x-api-key": env.JUPITER_API_KEY } : {}) });
const jupBase = (env: RealEnv) => (env.JUPITER_API_URL?.startsWith("https://") ? env.JUPITER_API_URL : JUP);

const toIx = (i: JupIx) =>
  new TransactionInstruction({
    programId: new PublicKey(i.programId),
    keys: i.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Uint8Array.from(atob(i.data), (c) => c.charCodeAt(0)) as unknown as Buffer,
  });

/** The wallet's associated token account for a mint: derived, so it's known even before it exists. */
function ataFor(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()], ATA_PROGRAM)[0];
}

const u64le = (b64: string): bigint => {
  const d = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[64 + i] ?? 0);
  return v;
};

export function realDeps(env: RealEnv, cfg: RealConfig): Deps | null {
  if (!env.DB) return null;
  const treasury = cfg.treasuryAddress ? new PublicKey(cfg.treasuryAddress) : null;
  const feeBps = treasury ? cfg.feeBps : 0;
  const decCache = new Map<string, number>();

  return {
    cfg,
    ledger: d1Ledger(env.DB),
    now: () => Date.now(),
    rand: () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join(""),
    solUsd: async () => (await marks([WSOL_MINT])).get(WSOL_MINT) ?? null,
    market: async (c) => { const m = await lookup(c); return m ? { price: m.price, liquidityUsd: m.liquidity } : null; },
    decimals: async (c) => {
      if (decCache.has(c)) return decCache.get(c)!;
      const info = await getMintInfo(env, c).catch(() => null);
      if (!info) return null;
      decCache.set(c, info.decimals);
      return info.decimals;
    },
    established: (c) => tvSymbolFor(c) !== null,
    mint: async (c) => {
      const info = await getMintInfo(env, c).catch(() => null);
      const s = summarizeSafety(c, info);
      // "good" only if nobody can print more AND nobody can freeze your tokens
      return s && s.checks.filter((x) => x.key === "mint" || x.key === "freeze").every((x) => x.level === "good") ? "good" : s?.checks[0].level === "unknown" ? "unknown" : "warn";
    },
    quote: async (from, target, amountRaw, slippage) => {
      // the platform fee is taken in SOL on the SOL side of the swap (see buildAndSimulate), so the quote is for what is actually swapped
      const solIn = from === WSOL_MINT;
      const swapAmount = solIn && feeBps > 0 ? amountRaw - (amountRaw * BigInt(feeBps)) / 10_000n : amountRaw;
      const u = new URL(`${jupBase(env)}/quote`);
      u.search = new URLSearchParams({ inputMint: from, outputMint: target, amount: swapAmount.toString(), slippageBps: String(Math.round(slippage * 10_000)), restrictIntermediateTokens: "true", maxAccounts: "54" }).toString();
      const r = await fetch(u, { headers: jupHeaders(env), signal: AbortSignal.timeout(8000) });
      if (r.status === 400 || r.status === 404) return null; // no route
      if (!r.ok) throw new Error(`jupiter ${r.status}`);
      const q = (await r.json()) as JupQuote;
      if (!q || typeof q.outAmount !== "string") return null;
      return { amountIn: amountRaw, amountOut: BigInt(q.outAmount), insufficient: false, router: q };
    },
    buildAndSimulate: async (router, address, slippage) => {
      void slippage;
      const quote = router as JupQuote;
      const owner = new PublicKey(address);
      const solIn = (quote as unknown as { inputMint?: string }).inputMint === WSOL_MINT;
      const q2 = quote as unknown as { inputMint: string; outputMint: string };
      const tradedMint = new PublicKey(solIn ? q2.outputMint : q2.inputMint);

      const sr = await fetch(`${jupBase(env)}/swap-instructions`, {
        method: "POST",
        headers: jupHeaders(env),
        body: JSON.stringify({ quoteResponse: quote, userPublicKey: address, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: MAX_PRIORITY_LAMPORTS, priorityLevel: "high" } } }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!sr.ok) throw new Error(`jupiter swap ${sr.status}`);
      const si = (await sr.json()) as {
        computeBudgetInstructions?: JupIx[]; setupInstructions?: JupIx[]; swapInstruction: JupIx; cleanupInstruction?: JupIx | null; otherInstructions?: JupIx[]; addressLookupTableAddresses?: string[];
      };

      const ixs: TransactionInstruction[] = [
        ...(si.computeBudgetInstructions ?? []).map(toIx),
        ...(si.otherInstructions ?? []).map(toIx),
        ...(si.setupInstructions ?? []).map(toIx),
        toIx(si.swapInstruction),
        ...(si.cleanupInstruction ? [toIx(si.cleanupInstruction)] : []),
      ];
      /* Platform fee, in SOL, atomically in the same transaction, paid straight to the treasury.
         Buy: fee = feeBps of the SOL the user chose to spend (the swap only used the rest).
         Sell: fee = feeBps of the guaranteed minimum SOL out, so it can never exceed what the sale pays. */
      if (treasury && feeBps > 0) {
        const feeLamports = solIn
          ? (BigInt(quote.inAmount) * BigInt(feeBps)) / (10_000n - BigInt(feeBps)) // inAmount is post-fee; gross = in / (1 - fee)
          : (BigInt(quote.otherAmountThreshold) * BigInt(feeBps)) / 10_000n;
        if (feeLamports > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: treasury, lamports: feeLamports }));
      }

      const [bh, luts] = await Promise.all([
        rpc<{ value: { blockhash: string } }>(env, "getLatestBlockhash", [{ commitment: "confirmed" }]),
        Promise.all((si.addressLookupTableAddresses ?? []).map(async (a) => {
          const info = await rpc<{ value: { data: [string, string] } | null }>(env, "getAccountInfo", [a, { encoding: "base64" }]);
          if (!info.value) throw new Error("lookup table missing");
          return new AddressLookupTableAccount({ key: new PublicKey(a), state: AddressLookupTableAccount.deserialize(Uint8Array.from(atob(info.value.data[0]), (c) => c.charCodeAt(0))) });
        })),
      ]);
      const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: bh.value.blockhash, instructions: ixs }).compileToV0Message(luts);
      const tx = new VersionedTransaction(msg);
      const bytes = btoa(String.fromCharCode(...tx.serialize()));

      // pre-state, then a dry run of the exact bytes with no signature: what would this wallet's balances become?
      const mintInfo = await getMintInfo(env, tradedMint.toBase58());
      const tokenProgram = new PublicKey(mintInfo?.program ?? "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      const ata = ataFor(owner, tradedMint, tokenProgram);
      const watch = [owner.toBase58(), ata.toBase58()];
      const pre = await rpc<{ value: ({ lamports: number; data: [string, string] } | null)[] }>(env, "getMultipleAccounts", [watch, { encoding: "base64" }]);
      const sim = await rpc<{ value: { err: unknown; accounts: ({ lamports: number; data: [string, string] } | null)[] | null } }>(env, "simulateTransaction", [
        bytes, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: watch } },
      ]);
      const success = sim.value.err === null && !!sim.value.accounts;
      const changes: Change[] | undefined = sim.value.accounts
        ? [
            { coinType: WSOL_MINT, address, amount: String(BigInt(sim.value.accounts[0]?.lamports ?? 0) - BigInt(pre.value[0]?.lamports ?? 0)) },
            { coinType: tradedMint.toBase58(), address, amount: String((sim.value.accounts[1] ? u64le(sim.value.accounts[1].data[0]) : 0n) - (pre.value[1] ? u64le(pre.value[1].data[0]) : 0n)) },
          ]
        : undefined;
      return { tx: "", bytes: success ? bytes : "", success, changes };
    },
  };
}
