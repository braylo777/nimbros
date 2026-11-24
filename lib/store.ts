"use client";

/* ---------------------------------------------------------------
   Formatters — every glanceable figure is mono, so keep them terse.
   --------------------------------------------------------------- */

export function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(2)}`;
}

export function fmtNum(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function fmtPrice(n: number): string {
  if (n >= 1) return `$${n.toFixed(4)}`;
  if (n >= 0.001) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(9).replace(/0+$/, "")}`;
}

export function fmtPct(n: number): string {
  const r = Number(n.toFixed(1));
  // avoid rendering a signed zero as "-0.0%"
  if (r === 0) return "0.0%";
  return `${r > 0 ? "+" : ""}${r.toFixed(1)}%`;
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
