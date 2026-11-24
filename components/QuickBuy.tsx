"use client";

import { useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { requestWallet, useWalletStore } from "@/lib/walletStore";
import { WalletModal } from "./Chrome";
import { useApp } from "./AppState";
import { formatUnits } from "@/lib/units";
import { recordFill } from "@/lib/fills";
import { showReceipt } from "@/lib/receipt";
import { reportSwap } from "@/lib/reportSwap";
import { useQuickAmount } from "@/lib/quickAmount";
import { screenBeforeSign } from "@/lib/shieldClient";
import { noteBlocked, noteScreened } from "@/lib/safetyState";
import { checkQuote } from "@/lib/quoteCheck";
import { WSOL_MINT } from "@/lib/chain";
import { quickCheck } from "@/lib/quickCheck";
import type { Token } from "@/lib/types";

/* One-tap trading from a list card. The server builds and simulates the swap (and refuses it if the simulation
   doesn't match), then your wallet is asked to sign: that wallet prompt is the confirmation. Nothing moves
   without your signature. Bolt buys the preset size; Close sells everything you hold of that coin. */

interface Plan { impactPct?: number; feeBps?: number; gasRaw?: string; txBytes: string; side: "buy" | "sell"; expectedOutRaw: string; spend: string; spendDecimals: number; receiveDecimals: number; usd: number }

export const Bolt = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M9.2 1 3 9h4l-1 6 7-8.6H9L9.2 1z" /></svg>
);

export function useSwapNow(tok: Token) {
  const wallet = useWalletStore();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);

  const run = async (side: "buy" | "sell", amount: string) => {
    if (busy) return;
    if (!wallet.address) {
      requestWallet();
      setPicker(true);
      return;
    }
    if (side === "buy") {
      const qc = quickCheck(tok);
      // a coin marked Risky asks for an explicit yes before anything is built; nothing is signed either way until the wallet prompt
      if (qc.level === "risk" && !window.confirm(`${tok.ticker} is marked Caution: ${qc.why.join("; ")}.\n\nBuy anyway?`)) return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/swap/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ side, coin: tok.contract, amount, address: wallet.address }),
      });
      const plan = (await r.json()) as Plan & { error?: string };
      if (!r.ok || !plan.txBytes) return toast(plan.error ?? "Couldn't build that swap.");
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(plan.txBytes), (c) => c.charCodeAt(0)));
      // Shield: read the transaction's own bytes before the wallet ever sees it. A block stops here; if the screen can't run we go on (the server already simulated it).
      const shield = await screenBeforeSign(plan.txBytes, wallet.address);
      noteScreened();
      if (shield?.verdict === "block") { noteBlocked(tok.ticker, shield.findings.find((f) => f.level === "block")?.message ?? "the transaction looks dangerous."); return toast(`Shield stopped this: ${shield.findings.find((f) => f.level === "block")?.message ?? "the transaction looks dangerous."}`); }
      // A second, independent opinion on the price: our own pool math (WASM) against the row's own reserves, never trusting the
      // aggregator alone. Only ever a caution — it never blocks, and a failed or skipped check changes nothing. Works for both
      // sides of the trade: a buy pays SOL and receives the token; a sell is the same pool run in the opposite direction.
      if (tok.reserveBase !== undefined && tok.reserveQuoteUsd !== undefined) {
        try {
          const solUsd = (await (await fetch(`/api/prices?ids=${WSOL_MINT}`)).json() as Record<string, number>)[WSOL_MINT];
          if (solUsd > 0) {
            const solRaw = BigInt(Math.round((tok.reserveQuoteUsd / solUsd) * 10 ** plan.spendDecimals));
            const tokenRaw = BigInt(Math.round(tok.reserveBase * 10 ** plan.receiveDecimals));
            const args = side === "buy"
              ? { reserveIn: solRaw, reserveOut: tokenRaw, amountIn: BigInt(plan.spend), quotedOut: BigInt(plan.expectedOutRaw) }
              : { reserveIn: tokenRaw, reserveOut: solRaw, amountIn: BigInt(plan.spend), quotedOut: BigInt(plan.expectedOutRaw) };
            const qc = await checkQuote({ ...args, feeBps: 30 });
            if (qc?.ok && qc.diffBps > 1500) toast(`Heads up: our own check of ${tok.ticker}'s pool suggests a noticeably worse price than quoted. This can happen with multi-hop routes; the trade is not blocked.`);
          }
        } catch { /* the check is a bonus; a failure here changes nothing about the trade */ }
      }
      const res = await wallet.sign({ transaction: tx });
      if (!res.success) return toast(res.timedOut ? "Still not confirmed. Check your wallet before trying again." : "The swap didn't fill. If the price moved, only the network fee was spent.", res.signature.slice(0, 10));
      recordFill({ coin: tok.contract, side, tokensRaw: side === "buy" ? plan.expectedOutRaw : plan.spend, decimals: side === "buy" ? plan.receiveDecimals : plan.spendDecimals, usd: plan.usd, sol: side === "buy" ? Number(plan.spend) / 10 ** plan.spendDecimals : Number(plan.expectedOutRaw) / 10 ** plan.receiveDecimals, ts: Date.now(), ticker: tok.ticker });
      const fmt = (raw: string, dec: number, sym: string) => `${(Number(raw) / 10 ** dec).toLocaleString("en-US", { maximumFractionDigits: dec > 6 ? 4 : 6 })} ${sym}`;
      showReceipt({ side, ticker: tok.ticker, paid: side === "buy" ? fmt(plan.spend, plan.spendDecimals, "SOL") : fmt(plan.spend, plan.spendDecimals, tok.ticker), got: side === "buy" ? fmt(plan.expectedOutRaw, plan.receiveDecimals, tok.ticker) : fmt(plan.expectedOutRaw, plan.receiveDecimals, "SOL"), impactPct: typeof plan.impactPct === "number" ? plan.impactPct : null, feeBps: typeof plan.feeBps === "number" ? plan.feeBps : null, networkSol: plan.gasRaw ? Number(plan.gasRaw) / 1e9 : null, sig: res.signature, ts: Date.now() });
      void reportSwap(res.signature);
      toast(side === "buy" ? `Bought ${tok.ticker}` : `Closed ${tok.ticker}`, res.signature.slice(0, 10));
    } catch (e) {
      const m = String((e as Error)?.message ?? "");
      toast(/reject|denied|cancel/i.test(m) ? "Cancelled in your wallet. Nothing was sent." : "Couldn't complete that trade. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, picker, closePicker: () => setPicker(false), wallet, toast };
}

export function QuickBuy({ tok }: { tok: Token }) {
  const amount = useQuickAmount();
  const { run, busy, picker, closePicker } = useSwapNow(tok);
  return (
    <>
      <button className="tk-quick" disabled={busy} title={`Buy ${amount} SOL of ${tok.ticker} now`} aria-label={`Quick buy ${amount} SOL of ${tok.ticker}`} onClick={(e) => { e.stopPropagation(); void run("buy", String(amount)); }}>
        <Bolt /> {busy ? "…" : amount}
      </button>
      {picker && <WalletModal onClose={closePicker} />}
    </>
  );
}

export function QuickClose({ tok }: { tok: Token }) {
  const { run, busy, wallet, toast, picker, closePicker } = useSwapNow(tok);
  const [checking, setChecking] = useState(false);
  const close = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy || checking) return;
    if (!wallet.address) return void run("sell", "0"); // opens the wallet picker
    setChecking(true);
    try {
      const [{ tokenBalanceRaw }, d] = await Promise.all([
        import("@/lib/solBalance"),
        fetch(`/api/coin/decimals?coin=${encodeURIComponent(tok.contract)}`).then((r) => r.json() as Promise<{ decimals?: number }>),
      ]);
      const raw = await tokenBalanceRaw(wallet.address, tok.contract);
      if (typeof d.decimals !== "number") return toast("Couldn't read that coin's details.");
      if (raw === 0n) return toast(`You don't hold any ${tok.ticker}.`);
      setChecking(false);
      await run("sell", formatUnits(raw, d.decimals));
    } catch {
      toast("Couldn't read your balance. Nothing was sent.");
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
    {picker && <WalletModal onClose={closePicker} />}
    <button className="tk-close" disabled={busy || checking} title={`Sell all of your ${tok.ticker} now`} aria-label={`Close ${tok.ticker} position`} onClick={close}>
      {busy || checking ? "…" : "Close"}
    </button>
    </>
  );
}
