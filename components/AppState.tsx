"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { requestWallet, useWalletStore, type WalletValue } from "@/lib/walletStore";
import { hydrateWatch } from "@/lib/watchStore";

export type ViewId =
  | "home"
  | "trade"
  | "agents"
  | "track";

interface Toast {
  id: number;
  text: string;
  mono?: string;
}

interface Ctx {
  view: ViewId;
  showView: (v: ViewId) => void;

  curToken: string | null;
  setCurToken: (id: string) => void;

  /** Real wallet state, from the Solana wallet-adapter / Wallet Standard. */
  wallet: WalletValue;
  requireWallet: () => boolean;

  toasts: Toast[];
  toast: (text: string, mono?: string) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<ViewId>("home");
  const [curToken, setCurTokenState] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const wallet = useWalletStore();

  /* watchlist: read post-mount so prerender and first client render agree */
  useEffect(() => {
    hydrateWatch();
  }, []);

  const toast = useCallback((text: string, mono?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, mono }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const requireWallet = useCallback(() => {
    if (wallet.address) return true;
    requestWallet();
    toast("Connect a Solana wallet first.");
    return false;
  }, [wallet.address, toast]);

  /* Views are client state, so the browser's Back button (and the phone's back swipe) needs history entries of our own:
     each move pushes one, and Back restores the view and coin that were on screen. */
  const viewRef = useRef<ViewId>("home");
  const tokRef = useRef<string | null>(null);

  useEffect(() => {
    history.replaceState({ __NA: true, v: "home", t: null }, ""); // __NA: tells Next.js this entry is ours, so Back does not reload the page
    const onPop = (e: PopStateEvent) => {
      const st = e.state as { v?: ViewId; t?: string | null } | null;
      viewRef.current = st?.v ?? "home";
      tokRef.current = st?.t ?? null;
      setView(viewRef.current);
      setCurTokenState(tokRef.current);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const showView = useCallback((v: ViewId) => {
    if (v !== viewRef.current) {
      viewRef.current = v;
      history.pushState({ __NA: true, v, t: tokRef.current }, "");
    }
    setView(v);
    window.scrollTo({ top: 0 });
  }, []);

  const setCurToken = useCallback((id: string) => {
    if (tokRef.current === id) return;
    tokRef.current = id;
    setCurTokenState(id);
    // switching coins while already on a coin is its own step; opening one from a list is pushed by showView("trade")
    if (viewRef.current === "trade") {
      history.pushState({ __NA: true, v: "trade", t: id }, "");
      window.scrollTo({ top: 0 });
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      view,
      showView,
      curToken,
      setCurToken,
      wallet,
      requireWallet,
      toasts,
      toast,
    }),
    [
      view,
      showView,
      curToken,
      setCurToken,
      wallet,
      requireWallet,
      toasts,
      toast,
    ]
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
