"use client";

import { useSyncExternalStore } from "react";
import { CHAINS, CHAIN_LIST, type Chain, type ChainId } from "./chains.ts";

/* The EVM side of the wallet: any EIP-1193 wallet in the browser (Phantom's EVM account, MetaMask, Coinbase Wallet, Rabby …), found through EIP-6963
   (with window.ethereum as the fallback). Nothing is stored: not the address, not a key. The wallet signs and sends every transaction itself; NimBros
   only builds the request and reads the result. */

interface Eip1193 {
  request(a: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(e: string, f: (...a: unknown[]) => void): void;
  removeListener?(e: string, f: (...a: unknown[]) => void): void;
}
export interface FoundWallet { id: string; name: string; icon?: string; provider: Eip1193 }
export interface EvmState { address: string | null; chainId: number | null; wallet: string | null }

let found: FoundWallet[] = [];
let state: EvmState = { address: null, chainId: null, wallet: null };
let active: Eip1193 | null = null;
const subs = new Set<() => void>();
const set = (s: EvmState) => { state = s; subs.forEach((f) => f()); };

let started = false;
export function discoverEvmWallets(): FoundWallet[] {
  if (typeof window === "undefined") return [];
  if (!started) {
    started = true;
    window.addEventListener("eip6963:announceProvider", ((e: CustomEvent<{ info: { uuid: string; name: string; icon: string }; provider: Eip1193 }>) => {
      const d = e.detail;
      if (!d?.info || found.some((w) => w.id === d.info.uuid)) return;
      found = [...found, { id: d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider }];
      subs.forEach((f) => f());
    }) as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }
  const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (found.length === 0 && legacy) return [{ id: "injected", name: "Browser wallet", provider: legacy }];
  return found;
}

/** Phantom first (it is the Solana wallet most users already have), then MetaMask, then whatever else announced itself. */
export function preferredWallet(): FoundWallet | undefined {
  const all = discoverEvmWallets();
  return all.find((w) => /phantom/i.test(w.name)) ?? all.find((w) => /metamask/i.test(w.name)) ?? all[0];
}

const hexToNum = (h: unknown): number | null => (typeof h === "string" && /^0x[0-9a-f]+$/i.test(h) ? Number(BigInt(h)) : null);
const toHex = (n: number | bigint) => "0x" + BigInt(n).toString(16);

function attach(p: Eip1193) {
  const onAccounts = (a: unknown) => { const x = Array.isArray(a) ? (a[0] as string | undefined) : undefined; set({ ...state, address: x ?? null }); };
  const onChain = (c: unknown) => set({ ...state, chainId: hexToNum(c) });
  p.on?.("accountsChanged", onAccounts);
  p.on?.("chainChanged", onChain);
}

export async function connectEvm(w: FoundWallet | undefined = preferredWallet()): Promise<string> {
  if (!w) throw new Error("No EVM wallet found in this browser. Install Phantom, MetaMask or Rabby, then reload.");
  const accounts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.[0]) throw new Error("The wallet returned no account.");
  const chainId = hexToNum(await w.provider.request({ method: "eth_chainId" }));
  if (active !== w.provider) { active = w.provider; attach(w.provider); }
  set({ address: accounts[0], chainId, wallet: w.name });
  return accounts[0];
}

export function disconnectEvm() { set({ address: null, chainId: null, wallet: null }); active = null; }

export async function switchEvmChain(c: Chain): Promise<void> {
  if (!active || c.evmId === undefined) throw new Error("Connect an EVM wallet first.");
  try {
    await active.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(c.evmId) }] });
  } catch (e) {
    if ((e as { code?: number })?.code !== 4902) throw e;
    // the wallet doesn't know this network yet: ask it to add it (the user approves in the wallet)
    await active.request({ method: "wallet_addEthereumChain", params: [{ chainId: toHex(c.evmId), chainName: c.name, nativeCurrency: { name: c.native, symbol: c.native, decimals: 18 }, rpcUrls: c.rpcs ?? [], blockExplorerUrls: [c.explorer] }] });
  }
  set({ ...state, chainId: hexToNum(await active.request({ method: "eth_chainId" })) });
}

export async function evmRequest<T>(method: string, params: unknown[] = []): Promise<T> {
  if (!active) throw new Error("Connect an EVM wallet first.");
  return (await active.request({ method, params })) as T;
}

/** Sends a contract deployment (no `to`): the wallet shows it and the user approves. Returns the transaction hash. */
export async function sendDeploy(from: string, data: string, gas: number): Promise<string> {
  return evmRequest<string>("eth_sendTransaction", [{ from, data, gas: toHex(gas), value: "0x0" }]);
}

export interface Receipt { status: "success" | "reverted"; contractAddress: string | null; blockNumber: number | null }
export async function waitForReceipt(hash: string, timeoutMs = 240_000): Promise<Receipt | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await evmRequest<{ status?: string; contractAddress?: string | null; blockNumber?: string } | null>("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r) return { status: r.status === "0x1" ? "success" : "reverted", contractAddress: r.contractAddress ?? null, blockNumber: hexToNum(r.blockNumber) };
    await new Promise((res) => setTimeout(res, 2500));
  }
  return null;
}

export const evmCall = (to: string, data: string) => evmRequest<string>("eth_call", [{ to, data }, "latest"]);

export const useEvmWallet = (): EvmState => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state, () => ({ address: null, chainId: null, wallet: null }));
export const chainByEvmId = (id: number | null): Chain | undefined => CHAIN_LIST.find((c) => c.evmId === id);
export type { ChainId };
void CHAINS;
