"use client";

import { WalletLoader } from "@/components/WalletLoader";
import { ChunkGuard } from "@/components/ChunkGuard";
import { AppProvider, useApp, type ViewId } from "@/components/AppState";
import { useState } from "react";
import { Shell, Toasts, TopBar } from "@/components/Chrome";
import { HomeView } from "@/components/HomeView";
import { TradeView } from "@/components/TradeView";
import { DeepLink } from "@/components/DeepLink";
import dynamic from "next/dynamic";

/* The agents screen is loaded on demand so the first paint (Home) stays light. */
const AgentsView = dynamic(() => import("@/components/AgentsView").then((m) => m.AgentsView), { ssr: false });
const TrackView = dynamic(() => import("@/components/TrackView").then((m) => m.TrackView), { ssr: false });

/* Mounts a heavy screen (and downloads its code) only once it has been opened, then keeps it. */
function AfterFirstVisit({ id, children }: { id: ViewId; children: React.ReactNode }) {
  const { view } = useApp();
  const [seen, setSeen] = useState(false);
  if (view === id && !seen) setSeen(true);
  return seen || view === id ? <>{children}</> : null;
}

export default function Page() {
  return (
    <>
      <ChunkGuard />
      <WalletLoader />
      <AppProvider>
        <Shell>
          <div className="main">
            <TopBar />
            <HomeView />
            <TradeView />
            <AfterFirstVisit id="agents"><AgentsView /></AfterFirstVisit>
            <AfterFirstVisit id="track"><TrackView /></AfterFirstVisit>
          </div>
        </Shell>
        <DeepLink />
        <Toasts />
      </AppProvider>
    </>
  );
}
