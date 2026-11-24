"use client";

import { useApp } from "./AppState";
import { openPortal } from "@/lib/hubTab";

/* Agents screen header: the way back into your wallet portal. (Protect and Track live inside the portal, see WalletPortal.) */
export function HubTabs() {
  const { wallet } = useApp();
  if (!wallet.address) return null;
  return (
    <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => openPortal("protect")}>
      ← My NimBros wallet
    </button>
  );
}

/* Old "track" view: kept so links and Back history still land somewhere; it simply opens the portal. */
export function TrackView() {
  return null;
}
