"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection, useWallet as useAdapterWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { lamportsToSol } from "./chain.ts";
import { NETWORK } from "./solana.ts";

/**
 * Wraps the Solana wallet-adapter into the shape the UI needs. Everything here is real: wallets are whatever
 * the browser actually exposes through the Wallet Standard (Phantom, Solflare, Backpack …), and the balance
 * comes from an RPC node.
 */
/** read by the provider's autoConnect: false while a user-initiated connect is running */
export const manualConnect = { active: false };

export function useWallet() {
  const { connection } = useConnection();
  const w = useAdapterWallet();
  const address = w.publicKey?.toBase58() ?? null;

  /* The balance is stored with the address it belongs to and then derived, so a result never
     leaks across an account switch and the effect never has to synchronously reset state. */
  const [fetched, setFetched] = useState<{ address: string; balance: number | "error" } | null>(null);

  useEffect(() => {
    if (!w.publicKey || !address) return;
    let alive = true;
    const load = () =>
      connection
        .getBalance(w.publicKey!, "confirmed")
        .then((lamports) => alive && setFetched({ address, balance: lamportsToSol(lamports) }))
        // RPC unreachable — surface "unavailable", never a made-up number
        .catch(() => alive && setFetched({ address, balance: "error" }));
    void load();
    const id = window.setInterval(load, 20_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [address, connection, w.publicKey]);

  const current = fetched && fetched.address === address ? fetched : null;
  const balance = typeof current?.balance === "number" ? current.balance : null;
  const balanceError = current?.balance === "error";

  const { wallets, select, disconnect: adapterDisconnect } = w;
  const list = wallets
    .filter((x) => x.readyState === WalletReadyState.Installed || x.readyState === WalletReadyState.Loadable)
    .map((x) => ({ name: x.adapter.name as string, icon: x.adapter.icon }));

  /* One explicit connect request, made by us. The provider's autoConnect is told to stand down while we do it (manualConnect), because Phantom
     answers two simultaneous requests with "Unexpected error" (-32603). A -32603 on the first try is usually a stale session: retry once. */
  const selectedRef = useRef<string | null>(null);
  useEffect(() => { selectedRef.current = w.wallet?.adapter.name ?? null; }, [w.wallet]);
  const connect = useCallback(
    async (walletName: string) => {
      const found = wallets.find((x) => x.adapter.name === walletName);
      if (!found) throw new Error(`Wallet not found: ${walletName}`);
      if (found.adapter.connected) return;
      manualConnect.active = true;
      try {
        select(found.adapter.name);
        for (let i = 0; i < 40 && selectedRef.current !== walletName; i++) await new Promise((r) => setTimeout(r, 50));
        try {
          await found.adapter.connect();
        } catch (e) {
          if (!/-32603|unexpected/i.test(String((e as { message?: string; error?: { code?: number } })?.message) + String((e as { error?: { code?: number } })?.error?.code))) throw e;
          await new Promise((r) => setTimeout(r, 700));
          try {
            await found.adapter.connect();
          } catch {
            // Phantom's own injected provider gives a clearer refusal than the Wallet Standard path; if it approves, the adapter then attaches
            const legacy = (window as unknown as { phantom?: { solana?: { connect: () => Promise<unknown> } } }).phantom?.solana;
            if (!legacy || found.adapter.name !== "Phantom") throw e;
            try { await legacy.connect(); } catch (le) { const m = le as { message?: string; code?: number }; throw new Error(`Phantom refused: ${m.message ?? "unknown"} (code ${m.code ?? "?"})`); }
            await found.adapter.connect();
          }
        }
      } finally {
        manualConnect.active = false;
      }
    },
    [wallets, select]
  );

  const disconnect = useCallback(async () => {
    await adapterDisconnect();
  }, [adapterDisconnect]);

  return {
    address,
    balance,
    balanceError,
    network: NETWORK as string,
    wallets: list,
    walletName: w.wallet?.adapter.name ?? null,
    isConnected: w.connected,
    isConnecting: w.connecting,
    connect,
    disconnect,
    switchNetwork: (() => {}) as (n?: string) => void,
  };
}
