import { useSyncExternalStore } from "react";

/* The NimBros wallet portal (the panel that opens from your wallet): whether it is open and which tab shows. A tiny shared store so the
   top bar, the phone bottom bar and the portal agree without threading props. */
export type HubTab = "protect" | "positions" | "track";
let state: { open: boolean; tab: HubTab } = { open: false, tab: "protect" };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const openPortal = (tab: HubTab = state.tab) => { state = { open: true, tab }; emit(); };
export const closePortal = () => { state = { ...state, open: false }; emit(); };
export const setHubTab = (tab: HubTab) => { state = { ...state, tab }; emit(); };
const SERVER = { open: false, tab: "protect" as HubTab };
export const usePortal = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state, () => SERVER);
export const useHubTab = (): HubTab => usePortal().tab;

/* The wallet PICKER (choose/connect a wallet), separate from the portal above: shared so the phone bottom bar's "Wallet" tab can open
   it directly, now that there is no top-right button to click through. */
let pickerOpen = false;
const pickerSubs = new Set<() => void>();
export const openPicker = () => { pickerOpen = true; pickerSubs.forEach((f) => f()); };
export const closePicker = () => { pickerOpen = false; pickerSubs.forEach((f) => f()); };
export const usePickerOpen = (): boolean => useSyncExternalStore((f) => { pickerSubs.add(f); return () => { pickerSubs.delete(f); }; }, () => pickerOpen, () => false);
