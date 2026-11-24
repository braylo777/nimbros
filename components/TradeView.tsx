"use client";

import { openedToken } from "@/lib/openedTokens";
import { useApp } from "./AppState";
import { useFeed } from "@/lib/feedStore";
import { LiveTokenBody } from "./LiveTokenView";

/* The trade screen. Every coin here comes from the live Solana feeds — there is no simulated or
   demo token behind this view, so a coin that isn't in the feed is just not found, not faked. */

export function TradeView() {
  const { view, curToken } = useApp();
  const on = view === "trade";
  const feed = useFeed();
  const tok = curToken ? [...feed.snipes, ...feed.scalps].find((t) => t.id === curToken) ?? openedToken(curToken) : undefined;

  return (
    <div className={`view${on ? " on" : ""}`}>
      {on && (tok ? (
        <LiveTokenBody tok={tok} />
      ) : (
        <div className="panel" style={{ maxWidth: 420, margin: "40px auto", textAlign: "center" }}>
          <p className="prose" style={{ margin: 0 }}>
            {curToken ? "This coin isn't in the live lists right now." : "Loading…"}
          </p>
        </div>
      ))}
    </div>
  );
}
