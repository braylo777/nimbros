/* Transparent momentum backtest on a pool's own recent candles. PURE.

   Rule: hold the coin while the fast SMA of closes is above the slow SMA, else
   sit in cash. The decision at bar i uses closes up to i only and earns bar i+1's
   move (no look-ahead). Every entry and exit pays `costPerSide` (fee + slippage).
   It is IN-SAMPLE on a short window: a description of what the rule would have
   done on this chart, not a prediction and not a track record. */

export interface Backtest {
  bars: number;
  fast: number;
  slow: number;
  trades: number;
  wins: number;
  winRatePct: number | null;
  returnPct: number;
  buyHoldPct: number;
  maxDrawdownPct: number;
}

export const BT_COST_PER_SIDE = 0.005; // 0.3% fee + 0.2% slippage

function sma(xs: number[], n: number, i: number): number {
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += xs[k];
  return s / n;
}

export function backtestSma(closes: number[], fast = 5, slow = 20, costPerSide = BT_COST_PER_SIDE): Backtest | null {
  if (!closes.every((c) => Number.isFinite(c) && c > 0)) return null;
  if (closes.length < slow + 5 || fast >= slow) return null;

  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  let inPos = false;
  let tradeStartEq = 1;
  let trades = 0;
  let wins = 0;

  const close = (eq: number) => {
    trades++;
    if (eq > tradeStartEq) wins++;
  };

  for (let i = slow - 1; i < closes.length - 1; i++) {
    const want = sma(closes, fast, i) > sma(closes, slow, i);
    if (want && !inPos) {
      equity *= 1 - costPerSide;
      tradeStartEq = equity;
      inPos = true;
    } else if (!want && inPos) {
      equity *= 1 - costPerSide;
      close(equity);
      inPos = false;
    }
    if (inPos) equity *= closes[i + 1] / closes[i];
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / peak);
  }
  if (inPos) {
    equity *= 1 - costPerSide;
    close(equity);
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (peak - equity) / peak);
  }

  return {
    bars: closes.length,
    fast,
    slow,
    trades,
    wins,
    winRatePct: trades > 0 ? (wins / trades) * 100 : null,
    returnPct: (equity - 1) * 100,
    buyHoldPct: (closes[closes.length - 1] / closes[slow - 1] - 1) * 100,
    maxDrawdownPct: maxDd * 100,
  };
}

/** Buy pressure: share of 24h transactions that were buys. */
export function buyPressurePct(buys?: number, sells?: number): number | null {
  if (buys === undefined || sells === undefined || buys + sells === 0) return null;
  return (buys / (buys + sells)) * 100;
}
