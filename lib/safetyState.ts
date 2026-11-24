import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/* What the wallet's status light means. One place, so the dot, the portal and the copy always agree.
   GREEN  "Trading":  the agents are on, watching, and the wallet is clear; trading is safe to go. Shows the agents' recent settled trades when there are some.
   YELLOW "Blocking": a threat is present (a dangerous approval or coin) or the agents blocked a dangerous transaction in the last 10 minutes.
   RED    "Defending": an unexplained outflow: SOL left this wallet and it wasn't signed through NimBros. Possible breach: the agents are in defence, act now.
   Only what can be observed drives it: scans, our own pre-sign blocks, and the balance. */

export type Light = "green" | "yellow" | "red" | "idle";
export interface BlockNote { at: number; ticker: string; why: string }
let blocks: BlockNote[] = [];
let scans = 0;
interface S { blockedAt: number; ownTxAt: number; breachAt: number; breachSol: number }
let s: S = { blockedAt: 0, ownTxAt: 0, breachAt: 0, breachSol: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<S>) => { s = { ...s, ...p }; subs.forEach((f) => f()); };
export const noteBlocked = (ticker = "", why = "") => { blocks = [{ at: Date.now(), ticker, why }, ...blocks].slice(0, 20); set({ blockedAt: Date.now() }); };
export const noteScreened = () => { scans++; subs.forEach((f) => f()); };
export const useBlockLog = () => { useS(); return { blocks, blockedToday: blocks.filter((b) => Date.now() - b.at < 86_400_000).length, screened: scans }; };
export const noteOwnTx = () => set({ ownTxAt: Date.now() });
export const clearBreach = () => set({ breachAt: 0, breachSol: 0 });
const useS = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => s, () => s);

const OUTFLOW_MIN_SOL = 0.02;
const OWN_WINDOW_MS = 120_000;

/** Watches the balance: a drop bigger than 0.02 SOL with no NimBros-signed transaction nearby is flagged. Mount once while connected. */
export function useBreachWatch(balance: number | null, address: string | null) {
  const prev = useRef<{ address: string; balance: number } | null>(null);
  useEffect(() => {
    if (!address || balance === null) { prev.current = null; return; }
    const p = prev.current;
    prev.current = { address, balance };
    if (!p || p.address !== address) return;
    const drop = p.balance - balance;
    if (drop >= OUTFLOW_MIN_SOL && Date.now() - s.ownTxAt > OWN_WINDOW_MS) set({ breachAt: Date.now(), breachSol: drop });
  }, [balance, address]);
}

export interface AgentActivity { trades24h: number; lastAt: number | null }
/** Settled trades made for this wallet by its linked agents (from /api/shield/agents). null until read. */
export function useAgentActivity(address: string | null): AgentActivity | null {
  const [a, setA] = useState<{ address: string; v: AgentActivity } | null>(null);
  useEffect(() => {
    if (!address) return;
    let alive = true;
    const run = () => fetch(`/api/shield/agents?address=${address}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AgentActivity>) : Promise.reject(new Error(String(r.status)))))
      .then((v) => alive && typeof v.trades24h === "number" && setA({ address, v }))
      .catch(() => { /* keep the last good value */ });
    void run();
    const t = setInterval(run, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [address]);
  return a && a.address === address ? a.v : null;
}

export interface LightInfo { light: Light; head: string; sub: string }
export function useLight(level: "safe" | "attention" | "danger" | undefined, complete: boolean | undefined, agents?: AgentActivity | null): LightInfo {
  const st = useS();
  if (st.breachAt) return { light: "red", head: "Defending", sub: `${st.breachSol.toFixed(3)} SOL left this wallet without a NimBros transaction. If it wasn't you, revoke approvals and move funds now.` };
  if (level === undefined) return { light: "idle", head: "Starting…", sub: "Your security agents are scanning." };
  if (level !== "safe") return { light: "yellow", head: "Blocking", sub: "Your agents found a threat and are blocking it. Open Security agents to clear it." };
  if (Date.now() - st.blockedAt < 600_000) return { light: "yellow", head: "Blocking", sub: "Your agents just blocked a dangerous transaction." };
  if (agents?.lastAt && Date.now() - agents.lastAt < 600_000) return { light: "green", head: "Trading", sub: `Your agents are trading and being watched: ${agents.trades24h} settled trade${agents.trades24h === 1 ? "" : "s"} in 24h. No threats found.` };
  if (!complete) return { light: "green", head: "Trading", sub: "Watching your wallet. Some deep checks couldn't run." };
  return { light: "green", head: "Trading", sub: "Watching your wallet. No threats found." };
}
