"use client";

/* Privacy-preserving product metrics. No cookies, no device or browser
   fingerprint, no wallet address, no IP stored by us — just a count of which
   named steps happen, sent to our own endpoint. The event name must be one of
   the literals below, so nothing user-typed can ever be sent by accident. */

export const EVENTS = [
  "coin_opened",
  "launch_reviewed",
  "launch_signed",
  "liquidity_added",
  "how_it_works_opened",
] as const;
export type EventName = (typeof EVENTS)[number];

let failed = false;

/** Fire-and-forget: never blocks the UI and never throws. */
export function track(name: EventName) {
  if (failed || typeof navigator === "undefined") return;
  if (!EVENTS.includes(name)) return;
  try {
    const body = JSON.stringify({ e: name });
    if (!navigator.sendBeacon?.(new URL("/api/event", location.origin), new Blob([body], { type: "application/json" }))) {
      void fetch("/api/event", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {
        failed = true;
      });
    }
  } catch {
    failed = true; // one failure is enough; stop trying for this page load
  }
}
