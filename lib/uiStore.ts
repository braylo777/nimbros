"use client";

import { useSyncExternalStore } from "react";

/* Tiny cross-component UI state: which Home tab is showing, and a draft for the
   Launch form (so a coin row can send you to Launch with the fields pre-filled). */

export type Tab = "launch" | "snipe" | "agent";
export interface LaunchDraft { name: string; symbol: string; seq: number; underlying?: string; ticker?: string }
interface Ui { tab: Tab; draft: LaunchDraft }

let ui: Ui = { tab: "snipe", draft: { name: "", symbol: "", seq: 0 } };
const subs = new Set<() => void>();
const set = (u: Ui) => {
  ui = u;
  subs.forEach((f) => f());
};

export const useUi = () =>
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => ui, () => ui);

export const setTab = (tab: Tab) => set({ ...ui, tab });
