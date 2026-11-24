"use client";

import { SearchBox } from "./SearchBox";
import { useEffect, useMemo, useState } from "react";
import { hydrateFilters, resetFilters, setFilters, useFilters } from "@/lib/filterStore";
import { DexLogo } from "./DexLogo";
import { dexName } from "@/lib/dex";
import { EMPTY_FILTERS, MEASURES, MORE, PRESETS, PRIMARY, QUICK, activeChips, activeCount, clearChip, compact, compactAge, isCustom, isPreset, parseAge, parseAmount, quickOn, toggleQuick, type Measure, type UserFilters } from "@/lib/userFilters";
import type { Token } from "@/lib/types";

/* The Filters button, its active-filter chips, and the sheet. Applies to Snipe and Scalp together and is remembered. */

const Icon = {
  sliders: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 6h9M16 6h1M3 14h1M8 14h9" /><circle cx="14" cy="6" r="2" /><circle cx="6" cy="14" r="2" /></svg>,
  close: <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>,
  search: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="9" r="5.5" /><path d="M13.5 13.5L17 17" /></svg>,
};

const SIDE: Record<Measure["unit"], { pre?: string; post?: string }> = { usd: { pre: "$" }, pct: { post: "%" }, x: { post: "×" }, count: {}, age: {} };
const show = (v: number | null, unit: Measure["unit"]) => (v === null ? "" : unit === "age" ? compactAge(v) : compact(v));

/** A number box that keeps what you're typing ("2." on the way to "2.5") and only takes the saved value when it changes from outside (a preset, Clear). */
function Box({ value, onText, ph, unit, label }: { value: string; onText: (t: string) => boolean; ph: string; unit: Measure["unit"]; label: string }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);
  if (value !== seen) {
    setSeen(value);
    if (!focused) setText(value);
  }
  const { pre, post } = SIDE[unit];
  return (
    <label className={`fs-in${value !== "" ? " set" : ""}${bad ? " bad" : ""}`}>
      {pre && <span>{pre}</span>}
      <input
        value={text}
        placeholder={ph}
        aria-label={label}
        inputMode="text"
        autoComplete="off"
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); setText(value); setBad(false); }}
        onChange={(e) => { setText(e.target.value); setBad(!onText(e.target.value)); }}
      />
      {post && <span>{post}</span>}
    </label>
  );
}

export function FilterBar({ rows, allRows = rows, shown, total, sortKey, sortKeys, sortLabel, onSortKey }: { rows: Token[]; allRows?: Token[]; shown: number; total: number; sortKey: string; sortKeys: readonly string[]; sortLabel: Record<string, string>; onSortKey: (k: string) => void }) {
  const f = useFilters();
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState<string[]>([]);
  useEffect(hydrateFilters, []);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [open]);

  const n = activeCount(f);
  const chips = activeChips(f);
  const dexes = useMemo(() => [...new Set(rows.map((r) => r.dex).filter((d): d is string => !!d))].sort(), [rows]);
  const activePreset = PRESETS.find((p) => isPreset(f, p.f));

  /** returns false when the text isn't a valid value, so the box can flag it */
  const setMeasure = (key: keyof UserFilters, unit: Measure["unit"], text: string): boolean => {
    const v = unit === "age" ? parseAge(text) : parseAmount(text);
    if (v === undefined) return false;
    setFilters({ ...f, [key]: v });
    return true;
  };
  const toggleDex = (d: string) => setFilters({ ...f, dex: f.dex.includes(d) ? f.dex.filter((x) => x !== d) : [...f.dex, d] });

  const renderMeasure = (id: string) => {
    const m = MEASURES.find((x) => x.id === id)!;
    const custom = isCustom(f, m) || customOpen.includes(id);
    return (
      <div className="fs-q" key={id}>
        <div className="fs-qlabel">{m.label}</div>
        <div className="fs-qchips">
          {(QUICK[id] ?? []).map((q) => (
            <button key={q.label} className={`fs-qchip${quickOn(f, m, q) ? " on" : ""}`} aria-pressed={quickOn(f, m, q)} onClick={() => setFilters(toggleQuick(f, m, q))}>{q.label}</button>
          ))}
          <button className={`fs-qchip link${custom ? " on" : ""}`} onClick={() => setCustomOpen(custom && !isCustom(f, m) ? customOpen.filter((x) => x !== id) : [...customOpen.filter((x) => x !== id), id])}>Custom</button>
        </div>
        {custom && (
          <div className="fs-custom">
            <div className="fs-range">
              <Box value={show(f[m.lo] as number | null, m.unit)} onText={(t) => setMeasure(m.lo, m.unit, t)} ph="Min" unit={m.unit} label={`${m.label} minimum`} />
              <span className="fs-dash">–</span>
              <Box value={show(f[m.hi] as number | null, m.unit)} onText={(t) => setMeasure(m.hi, m.unit, t)} ph="Max" unit={m.unit} label={`${m.label} maximum`} />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="fs-bar">
        <button className="fs-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
          {Icon.sliders}
          <span className="fs-label">Filters</span>
          {n > 0 && <span className="fs-badge">{n}</span>}
        </button>
        <SearchBox rows={allRows} />
        {chips.map((c) => (
          <button key={c.id} className="fs-active-chip" onClick={() => setFilters(clearChip(f, c.id))} title="Remove this filter">
            {c.label}
            {Icon.close}
          </button>
        ))}
        {n > 0 && (
          <>
            <span className="hint" style={{ margin: 0 }}>{shown} of {total}</span>
            <button className="fs-clear" onClick={resetFilters}>Clear all</button>
          </>
        )}
      </div>

      {open && (
        <div className="fs-scrim" onClick={() => setOpen(false)}>
          <div className="fs-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Filter coins">
            <div className="fs-head">
              <h2 className="fs-title">Filters</h2>
              <span className="fs-count">{shown} of {total} coins</span>
              <button className="fs-x" onClick={() => setOpen(false)} aria-label="Close">{Icon.close}</button>
            </div>

            <div className="fs-body">
              <div className="fs-sec">
                <div className="fs-presets" onMouseLeave={() => setHint(null)}>
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      className={`fs-preset${activePreset?.id === p.id ? " on" : ""}`}
                      onClick={() => setFilters(activePreset?.id === p.id ? EMPTY_FILTERS : { ...EMPTY_FILTERS, ...p.f })}
                      onMouseEnter={() => setHint(p.help)}
                      onFocus={() => setHint(p.help)}
                      onBlur={() => setHint(null)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="fs-help">{hint ?? activePreset?.help ?? "Tap a pick, or set the ranges below. A coin missing the data a filter needs is hidden by it."}</p>
              </div>

              <div className="fs-duo">
                {dexes.length > 0 && (
                  <div className="fs-sec">
                    <div className="fs-sectitle">Exchange</div>
                    <div className="fs-dexchips">
                      {dexes.map((d) => (
                        <button key={d} className={`fs-dexchip${f.dex.includes(d) ? " on" : ""}`} onClick={() => toggleDex(d)} aria-pressed={f.dex.includes(d)} title={dexName(d)} aria-label={dexName(d)}>
                          <DexLogo id={d} size={22} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="fs-sec">
                  <div className="fs-sectitle">Sort</div>
                  <select className="fs-sortsel" value={sortKey} onChange={(e) => onSortKey(e.target.value)} aria-label="Sort coins by">
                    {sortKeys.map((k) => <option key={k} value={k}>{sortLabel[k]}</option>)}
                  </select>
                </div>
              </div>

              <div className="fs-sec">{PRIMARY.map((id) => renderMeasure(id))}</div>

              <details className="fs-more" open={MORE.some((id) => { const m = MEASURES.find((x) => x.id === id)!; return (f[m.lo] as number | null) !== null || (f[m.hi] as number | null) !== null; })}>
                <summary>More filters</summary>
                <div>{MORE.map((id) => renderMeasure(id))}</div>
              </details>
            </div>

            <div className="fs-foot">
              <button className="btn ghost" onClick={resetFilters} disabled={n === 0}>Reset</button>
              <button className="btn" onClick={() => setOpen(false)}>Show {shown} {shown === 1 ? "coin" : "coins"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
