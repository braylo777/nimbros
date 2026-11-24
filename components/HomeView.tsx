"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useApp } from "./AppState";
import { ChainAndAmountPicker, EvmBrowseList } from "./EvmBrowseList";
import { EVM_CHAINS, type ChainId } from "@/lib/chains";
import { useState as useReactState } from "react";
import { FilterBar } from "./FilterBar";
import { HomeHero } from "./HomeHero";
import { LaunchPanel } from "./LaunchPanel";
import { TokenList } from "./TokenList";
import { resetFilters, useFilters } from "@/lib/filterStore";
import { activeCount, applyFilters } from "@/lib/userFilters";
import { FRESH_MIN, SCALP_MAX_MIN } from "@/lib/lifecycle";
import { loadPegs } from "@/lib/pegged";
import { setTab, useUi, type Tab } from "@/lib/uiStore";
import { startFeeds, useFeed } from "@/lib/feedStore";
import { DEFAULT_SORT, naturalSort, sortRows, SORT_LABEL, type ListKey, type SortKey, type SortState } from "@/lib/sortRows";
import { SNIPE_PRESETS, passesSnipe } from "@/lib/filters";

const ROWS = 120; // the feed already caps each list; filters narrow it further
/* Gate for the live Snipe feed: real new pools are mostly dust, so the demo-era
   presets (thousands in liquidity/volume) would hide everything. This keeps
   only what genuinely has liquidity. */
const LIVE_SNIPE_GATE = {
  ...SNIPE_PRESETS.lenient,
  minLiquidityUsd: 500,
  minMarketCapUsd: 0,
  minAgeMin: 0,
  maxAgeMin: Number.MAX_SAFE_INTEGER,
  minVol24hUsd: 0,
};

const TABS: { id: Tab; label: string }[] = [
  { id: "launch", label: "Launch" },
  { id: "snipe", label: "Snipe" },
  { id: "agent", label: "Scalp" },
];
const SORT_KEYS: SortKey[] = ["new", "vol", "chg", "liq", "bp", "mcap", "name"];

/** Whether the window is at least this wide (split view needs room for two tables). */
function useWide(min: number): boolean {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(`(min-width: ${min}px)`); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(`(min-width: ${min}px)`).matches,
    () => false
  );
}

const SORT_KEY = "nb_sort";
function readSort(): Record<ListKey, SortState> {
  try {
    const j = JSON.parse(localStorage.getItem(SORT_KEY) ?? "null") as Record<string, { key?: string; dir?: string }> | null;
    const ok = (s: { key?: string; dir?: string } | undefined, d: SortState): SortState => (s && SORT_KEYS.includes(s.key as SortKey) && (s.dir === "asc" || s.dir === "desc") ? { key: s.key as SortKey, dir: s.dir } : d);
    return { snipe: ok(j?.snipe, DEFAULT_SORT.snipe), agent: ok(j?.agent, DEFAULT_SORT.agent) };
  } catch { return DEFAULT_SORT; }
}


export function HomeView() {
  const { view } = useApp();
  const live = view === "home";
  const wide = useWide(1240);

  const feed = useFeed();
  const snipes = feed.snipes;
  const agents = feed.scalps;

  /* Live feeds: GeckoTerminal and DexScreener via /api/feed, polled only while Home is showing. */
  useEffect(() => {
    if (!live) return;
    void loadPegs();
    return startFeeds();
  }, [live]);

  /* The token page's chart is a ~50 KB chunk, loaded only when first needed. Warm it here, once the
     browser is idle after Home's own paint, so opening any token never waits on that fetch+parse. */
  useEffect(() => {
    if (!live) return;
    const ric = typeof requestIdleCallback === "function" ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 1500);
    const cric = typeof cancelIdleCallback === "function" ? cancelIdleCallback : clearTimeout;
    const id = ric(() => { void import("./PriceChart"); });
    return () => cric(id as never);
  }, [live]);

  const tab: Tab = useUi().tab;
  const filters = useFilters();
  const [sort, setSortState] = useState<Record<ListKey, SortState>>(DEFAULT_SORT);
  // saved choices are read after mount so the first render matches the server-rendered page
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe storage read, once on mount
    setSortState(readSort());
  }, []);
  const setSort = (k: ListKey, s: SortState) => setSortState((p) => { const n = { ...p, [k]: s }; try { localStorage.setItem(SORT_KEY, JSON.stringify(n)); } catch { /* fine */ } return n; });

  /* what the two lists may show, before any of the user's own filters: Snipe = launched in the last 24 hours, Scalp = 1 to 30 days old.
     Older coins are not in the lists; the search box finds them. The "Total coins live" number counts this same set. */
  const okSnipes = useMemo(() => snipes.filter((t) => t.ageMin !== undefined && t.ageMin < FRESH_MIN && passesSnipe(t, LIVE_SNIPE_GATE).ok), [snipes]);
  const okScalps = useMemo(() => agents.filter((t) => t.ageMin !== undefined && t.ageMin >= FRESH_MIN && t.ageMin <= SCALP_MAX_MIN), [agents]);
  const snipeRows = useMemo(() => sortRows(applyFilters(okSnipes, filters), sort.snipe).slice(0, ROWS), [okSnipes, filters, sort.snipe]);
  const scalpRows = useMemo(() => sortRows(applyFilters(okScalps, filters), sort.agent).slice(0, ROWS), [okScalps, filters, sort.agent]);
  const heroRows = useMemo(() => [...okSnipes, ...okScalps], [okSnipes, okScalps]);

  const filtering = activeCount(filters) > 0;
  const counts: Partial<Record<Tab, number>> = { snipe: snipeRows.length, agent: scalpRows.length };
  const isList = tab !== "launch";
  const showSplit = wide && isList; // Snipe and Scalp always sit side by side when there is room

  const list = (k: ListKey) => (
    <TokenList
      rows={k === "snipe" ? snipeRows : scalpRows}
      action={k === "snipe" ? "Snipe" : "Scalp"}
      sort={sort[k]}
      onSort={(s) => setSort(k, s)}
      status={k === "snipe" ? feed.status.snipe : feed.status.scalp}
      hiddenByFilters={filtering && (k === "snipe" ? okSnipes.length : okScalps.length) > 0}
      onClear={resetFilters}
    />
  );
  const activeKey: ListKey = tab === "agent" ? "agent" : "snipe";
  const [browseChain, setBrowseChain] = useReactState<ChainId | "solana">("solana");
  const evmChain = browseChain !== "solana" ? EVM_CHAINS.find((c) => c.id === browseChain) : undefined;

  return (
    <div className={`view hp${live ? " on" : ""}`}>
      <HomeHero rows={heroRows} />

      {/* Tabs, filters, search, sort, split and quick-buy size all share one line. */}
      <div className="hp-bar">
        <nav className="hp-tabs" aria-label="Markets">
          {TABS.map((t) => (
            <button key={t.id} className={`hp-tab${tab === t.id && !showSplit ? " on" : ""}${showSplit && t.id !== "launch" ? " on" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
              {counts[t.id] !== undefined && <span className="hp-tabn">{counts[t.id]}</span>}
            </button>
          ))}
        </nav>
        {isList && (
          <div className="hp-row2">
            <FilterBar
              rows={heroRows}
              shown={snipeRows.length + scalpRows.length}
              total={okSnipes.length + okScalps.length}
              sortKey={sort[activeKey].key}
              sortKeys={SORT_KEYS}
              sortLabel={SORT_LABEL}
              onSortKey={(k) => { const st: SortState = naturalSort(k as SortKey); if (showSplit) { setSort("snipe", st); setSort("agent", st); } else setSort(activeKey, st); }}
            />
            <div className="hp-tools">
              <ChainAndAmountPicker chain={browseChain} onChain={setBrowseChain} />
            </div>
          </div>
        )}
      </div>

      {tab === "launch" ? (
        <section className="hp-launch panel"><LaunchPanel /></section>
      ) : evmChain ? (
        <EvmBrowseList chain={evmChain} kind={tab === "agent" ? "scalp" : "snipe"} />
      ) : showSplit ? (
        <div className="hp-splitgrid">
          <div><h2 className="hp-listtitle">Snipe</h2>{list("snipe")}</div>
          <div><h2 className="hp-listtitle">Scalp</h2>{list("agent")}</div>
        </div>
      ) : (
        list(activeKey)
      )}
    </div>
  );
}
