"use client";

import { useSyncExternalStore } from "react";
import type { VersionedTransaction } from "@solana/web3.js";
import type { useWallet } from "./useWallet.ts";

/* The wallet layer is ~450 KB of JavaScript, so it is NOT part of the first page
   load. Until something asks for it, the app sees this stub (disconnected, no
   wallets). WalletRuntime, loaded on demand, replaces the stub with the real
   thing. Browsing and the feeds never need it.

   Who asks for it: the Connect button, any action that needs a wallet, and, at
   idle, a returning visitor who connected before (so auto-reconnect still works). */

type Base = ReturnType<typeof useWallet>;
/** `signature` is the transaction signature (Solana's tx id); `success` is false if it failed or never confirmed. */
export interface SignResult { signature: string; success: boolean; timedOut?: boolean }

export interface WalletValue extends Base {
  /** false until the wallet layer has loaded */
  ready: boolean;
  sign: (args: { transaction: VersionedTransaction }) => Promise<SignResult>;
  /** personal-message signature (base64), used to prove you own the wallet that published a coin */
  signMessage: (message: Uint8Array) => Promise<string>;
}

const notReady = async (): Promise<never> => {
  requestWallet();
  throw new Error("The wallet is still loading. Try again in a moment.");
};

const STUB: WalletValue = {
  address: null,
  balance: null,
  balanceError: false,
  network: "mainnet-beta",
  wallets: [],
  walletName: null,
  isConnected: false,
  isConnecting: false,
  connect: notReady,
  disconnect: async () => {},
  switchNetwork: (() => {}) as unknown as Base["switchNetwork"],
  ready: false,
  sign: notReady,
  signMessage: notReady,
};

let value: WalletValue = STUB;
let wanted = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export const useWalletStore = (): WalletValue =>
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => value, () => STUB);

export const useWalletWanted = (): boolean =>
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => wanted, () => false);

/** Ask for the wallet layer to be loaded. Safe to call any number of times. */
export function requestWallet() {
  if (wanted) return;
  wanted = true;
  notify();
}

const KEYS: (keyof Base)[] = ["address", "balance", "balanceError", "network", "walletName", "isConnected", "isConnecting", "connect", "disconnect", "switchNetwork"];

/** Called by WalletRuntime on every render; only publishes when something visible changed. */
export function publishWallet(next: WalletValue) {
  const same =
    value.ready === next.ready &&
    value.sign === next.sign &&
    KEYS.every((k) => value[k] === next[k]) &&
    value.wallets.length === next.wallets.length &&
    value.wallets.every((w, i) => w === next.wallets[i]);
  if (same) return;
  value = next;
  notify();
}

export function resetWallet() {
  value = STUB;
  notify();
}

const USED = "nb_wallet_used";
export const rememberWalletUsed = () => {
  try {
    localStorage.setItem(USED, "1");
  } catch {
    /* non-fatal */
  }
};
export const walletWasUsed = (): boolean => {
  try {
    return localStorage.getItem(USED) === "1";
  } catch {
    return false;
  }
};
