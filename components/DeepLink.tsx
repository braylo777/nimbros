"use client";

import { useEffect, useState } from "react";
import { useApp } from "./AppState";
import { startFeeds, useFeed } from "@/lib/feedStore";

/* Opens straight to a coin's trade page from a URL, e.g. nimbros.ai/?trade=0x...::coin::COIN
   The browser extension (and anything else off-site) links here instead of trying to embed a
   trade UI itself. Feeds are started immediately, independent of Home being the visible view, so
   the coin can be found even when this is the very first thing the page does. */

const TIMEOUT_MS = 15_000;

export function DeepLink() {
  const { showView, setCurToken } = useApp();
  const feed = useFeed();
  const [want, setWant] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "waiting" | "missed">("idle");

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("trade");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL read, once on mount, before anything else can render
    if (q) { setWant(q.toLowerCase()); setStatus("waiting"); }
  }, []);

  useEffect(() => {
    if (status !== "waiting") return;
    return startFeeds();
  }, [status]);

  useEffect(() => {
    if (status !== "waiting" || !want) return;
    const hit = [...feed.snipes, ...feed.scalps].find((t) => t.contract.toLowerCase() === want || t.id.toLowerCase() === want);
    if (!hit) return;
    setCurToken(hit.id);
    showView("trade");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to an external store (the feed) finally carrying the coin
    setStatus("idle");
    history.replaceState(null, "", location.pathname); // don't re-trigger on back/refresh
  }, [feed, status, want, setCurToken, showView]);

  useEffect(() => {
    if (status !== "waiting") return;
    const t = setTimeout(() => setStatus((s) => (s === "waiting" ? "missed" : s)), TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [status]);

  if (status === "waiting") {
    return (
      <div className="scrim" role="status" aria-live="polite">
        <div className="modal" style={{ alignItems: "center", textAlign: "center" }}>
          <div className="spinner" aria-hidden="true" />
          <p className="prose" style={{ margin: 0 }}>Finding that coin on NimBros…</p>
        </div>
      </div>
    );
  }
  if (status === "missed") {
    return (
      <div className="scrim" onClick={() => setStatus("idle")}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ alignItems: "center", textAlign: "center" }}>
          <p className="prose" style={{ margin: 0 }}>Couldn&apos;t find that coin. It may not be tracked yet, or the link is out of date.</p>
          <button className="btn ghost" onClick={() => setStatus("idle")}>Browse markets</button>
        </div>
      </div>
    );
  }
  return null;
}
