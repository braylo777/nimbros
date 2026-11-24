import { useEffect, useState } from "react";
import type { Launch } from "../functions/api/launches.ts";

/** Live list of launchpad coins. Polls our own endpoint every second while the tab is visible
    (it is edge-cached for 1s, so this is cheap and doesn't touch third-party rate limits). */
export function useLaunches(everyMs = 5000): Launch[] | null {
  const [rows, setRows] = useState<Launch[] | null>(null);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch("/api/launches", { signal: AbortSignal.timeout(4000) });
        if (r.ok && alive) setRows((await r.json()) as Launch[]);
      } catch { /* keep last */ }
    };
    void run();
    const t = setInterval(run, everyMs);
    return () => { alive = false; clearInterval(t); };
  }, [everyMs]);
  return rows;
}
export async function registerLaunch(coinType: string, agent?: string): Promise<void> {
  try {
    await fetch("/api/launches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coinType, agent }) });
  } catch { /* listing is optional; the coin exists regardless */ }
}

/** Verified agent names by creator address, from the launch list (a name shows only when signed). */
export function useLaunchAgents(): Record<string, string> {
  const rows = useLaunches(15_000);
  const out: Record<string, string> = {};
  for (const r of rows ?? []) if (r.creator && r.agent) out[r.creator] = r.agent;
  return out;
}
