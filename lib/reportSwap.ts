"use client";

/** Tells NimBros a swap succeeded so it counts toward the coins traded here. The server re-reads the chain; a slow index just needs a retry. */
export async function reportSwap(digest: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch("/api/swap/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest }) });
      if (r.status !== 404) return;
    } catch { return; }
    await new Promise((res) => setTimeout(res, 2500));
  }
}
