"use client";

import { useEffect, useState } from "react";
import { useApp } from "./AppState";

/* Shown once, on the home screen, to someone who has never connected: three steps. Dismissing it (or connecting) hides it for good on this device. */
const KEY = "nb.firstrun.v1";

export function FirstRun() {
  const { wallet } = useApp();
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(localStorage.getItem(KEY) !== "1"); } catch { setShow(true); }
  }, []);
  useEffect(() => {
    if (wallet.address) { try { localStorage.setItem(KEY, "1"); } catch { /* per-device convenience only */ } }
  }, [wallet.address]);
  if (!show || wallet.address) return null;
  const close = () => { setShow(false); try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } };
  return (
    <section className="firstrun" aria-label="Getting started">
      <ol>
        <li><b>1</b><span>Connect your wallet<small>One tap. We never hold your keys.</small></span></li>
        <li><b>2</b><span>Pick a coin marked Looks OK<small>Every coin gets a quick safety check.</small></span></li>
        <li><b>3</b><span>Buy with protection on<small>Risky trades are stopped before you sign.</small></span></li>
      </ol>
      <button className="btn ghost sm" onClick={close} aria-label="Dismiss">Got it</button>
    </section>
  );
}
