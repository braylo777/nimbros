"use client";

import { useEffect } from "react";

/* After a deploy, an already-open tab still points at script files that no longer
   exist, so the next lazy-loaded piece (wallet, chart) fails with a ChunkLoadError.
   Reload once to pick up the new build; the sessionStorage flag stops a reload loop. */
const FLAG = "nb_chunk_reload";
const isChunkError = (m: unknown) => /ChunkLoadError|Failed to load chunk|Loading chunk|error loading dynamically imported module/i.test(String(m));

export function ChunkGuard() {
  useEffect(() => {
    const reloadOnce = () => {
      try {
        if (sessionStorage.getItem(FLAG) === "1") return;
        sessionStorage.setItem(FLAG, "1");
      } catch {
        return; // can't remember we tried, so don't risk looping
      }
      location.reload();
    };
    const onError = (e: ErrorEvent) => isChunkError(e.message) && reloadOnce();
    const onRejection = (e: PromiseRejectionEvent) => isChunkError((e.reason as Error)?.message ?? e.reason) && reloadOnce();
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    // a successful load clears the flag, so a later deploy can trigger one more reload
    const t = setTimeout(() => {
      try {
        sessionStorage.removeItem(FLAG);
      } catch {
        /* non-fatal */
      }
    }, 10_000);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      clearTimeout(t);
    };
  }, []);
  return null;
}
