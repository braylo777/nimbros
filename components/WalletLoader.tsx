"use client";

import { useEffect, useState, type ComponentType } from "react";
import { requestWallet, useWalletWanted, walletWasUsed } from "@/lib/walletStore";

/* Loads the wallet layer only when it is wanted, so a first visit downloads none of it. */
export function WalletLoader() {
  const wanted = useWalletWanted();
  const [Runtime, setRuntime] = useState<ComponentType | null>(null);

  // a returning wallet user gets auto-reconnect, but only once the page is idle
  useEffect(() => {
    if (!walletWasUsed()) return;
    const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = idle ? idle(requestWallet, { timeout: 2500 }) : window.setTimeout(requestWallet, 1200);
    return () => {
      const cancel = (window as unknown as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback;
      if (idle && cancel) cancel(id);
      else window.clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    if (!wanted || Runtime) return;
    let alive = true;
    import("./WalletRuntime").then((m) => alive && setRuntime(() => m.WalletRuntime));
    return () => {
      alive = false;
    };
  }, [wanted, Runtime]);

  return Runtime ? <Runtime /> : null;
}
