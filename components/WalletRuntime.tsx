"use client";

import { useEffect, useMemo } from "react";
import { ConnectionProvider, WalletProvider, useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import type { VersionedTransaction } from "@solana/web3.js";
import { noteOwnTx } from "@/lib/safetyState";
import { useWallet, manualConnect } from "@/lib/useWallet";
import { publishWallet, rememberWalletUsed, resetWallet, type SignResult } from "@/lib/walletStore";

/* The real wallet layer. Loaded on demand (see WalletLoader); it renders nothing
   itself and just publishes its state to the wallet store the rest of the app reads. */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

function Bridge() {
  const w = useWallet();
  const { connection } = useConnection();
  const adapter = useAdapterWallet();

  useEffect(() => {
    const sign = async ({ transaction }: { transaction: VersionedTransaction }): Promise<SignResult> => {
      if (!adapter.signTransaction) throw new Error("This wallet can't sign transactions.");
      // the wallet signs; we send through our own RPC proxy so the wallet's node choice can't matter
      noteOwnTx();
      const signed = await adapter.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      noteOwnTx();
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const st = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: false })).value[0];
        if (st?.err) return { signature, success: false };
        if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { signature, success: true };
        await sleep(1200);
      }
      return { signature, success: false, timedOut: true };
    };
    const signMessage = async (m: Uint8Array): Promise<string> => {
      if (!adapter.signMessage) throw new Error("This wallet can't sign messages.");
      return b64(await adapter.signMessage(m));
    };
    publishWallet({ ...w, ready: true, sign, signMessage });
    if (w.address) rememberWalletUsed();
  });
  useEffect(() => resetWallet, []);
  return null;
}

export function WalletRuntime() {
  const endpoint = useMemo(() => `${window.location.origin}/api/rpc`, []);
  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      {/* no hardcoded wallet list: Wallet Standard wallets register themselves */}
      <WalletProvider wallets={[]} autoConnect={async () => !manualConnect.active}>
        <Bridge />
      </WalletProvider>
    </ConnectionProvider>
  );
}
