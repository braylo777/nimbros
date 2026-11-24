"use client";

import { useEffect, useState } from "react";

/* Whether a site allows itself to be shown live inside a hover card (an iframe). Checked once per site against its own headers
   (/api/frameable), remembered for the rest of the session. Sites that forbid it fall back to a screenshot instead. */
const known = new Map<string, boolean>();

export function useFrameable(url: string | undefined, enabled: boolean): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!enabled || !url || known.has(url)) return;
    let alive = true;
    fetch(`/api/frameable?u=${encodeURIComponent(url)}`)
      .then((r) => r.json() as Promise<{ ok?: boolean }>)
      .then((j) => { known.set(url, !!j.ok); if (alive) bump((n) => n + 1); })
      .catch(() => { known.set(url, false); });
    return () => { alive = false; };
  }, [url, enabled]);
  return !!(url && known.get(url));
}
