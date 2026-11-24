import type { Candle } from "./pool.ts";

/* Volume profile: how much traded at each price level over the bars you are looking at.
   A bar's volume is spread evenly over the levels between its low and high (a bar with no range sits in one level).
   Up bars and down bars are kept apart so a level shows who was pushing there. */

export interface ProfileRow { lo: number; hi: number; up: number; down: number; total: number }
export interface Profile {
  rows: ProfileRow[];
  /** point of control: the level with the most volume */
  poc: number;
  /** value area: the smallest run of levels around the POC holding `areaPct` of all volume, as [firstRow, lastRow] */
  area: [number, number];
  max: number;
}

export function volumeProfile(bars: Candle[], rowCount: number, lo: number, hi: number, areaPct = 0.7): Profile | null {
  if (!(hi > lo) || rowCount < 2 || bars.length === 0) return null;
  const step = (hi - lo) / rowCount;
  const rows: ProfileRow[] = Array.from({ length: rowCount }, (_, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, up: 0, down: 0, total: 0 }));
  const at = (p: number) => Math.min(rowCount - 1, Math.max(0, Math.floor((p - lo) / step)));
  for (const b of bars) {
    if (!(b.v > 0) || b.h < lo || b.l > hi) continue;
    const a = at(Math.max(b.l, lo)), z = at(Math.min(b.h, hi));
    const share = b.v / (z - a + 1);
    for (let i = a; i <= z; i++) {
      if (b.c >= b.o) rows[i].up += share; else rows[i].down += share;
    }
  }
  let sum = 0, poc = 0, max = 0;
  rows.forEach((r, i) => {
    r.total = r.up + r.down;
    sum += r.total;
    if (r.total > max) { max = r.total; poc = i; }
  });
  if (!(sum > 0)) return null;
  // grow the value area from the POC, always taking the heavier neighbour
  let a = poc, z = poc, got = rows[poc].total;
  while (got < sum * areaPct && (a > 0 || z < rowCount - 1)) {
    const below = a > 0 ? rows[a - 1].total : -1, above = z < rowCount - 1 ? rows[z + 1].total : -1;
    if (above >= below) { z++; got += rows[z].total; } else { a--; got += rows[a].total; }
  }
  return { rows, poc, area: [a, z], max };
}
