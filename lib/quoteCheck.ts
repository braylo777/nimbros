/* Client-side cross-check on a swap quote: recomputes what the pool would actually pay from ITS OWN reserves (already on the row we
   fetched) using the same constant-product math the pool runs on chain, and compares it to the aggregator's (Jupiter's) quote. This is
   an independent second opinion, not a replacement for Shield's on-chain simulation — a mismatch is shown as a caution, never a block on
   its own. Runs a small Rust/WASM module (rust/nimbros-quote-wasm) so the math is exact integer arithmetic, the same code that is unit-
   and property-tested in Rust. Loaded lazily; if it fails to load for any reason, the check is simply skipped — nothing else depends on it. */

export interface QuoteCheck { ok: boolean; localOut: bigint; diffBps: number; error?: string }

let mod: { check_quote: (i: unknown) => unknown } | null = null;
let loading: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (mod) return;
  if (!loading) {
    const path = "/wasm/nimbros_quote_wasm.js";
    loading = import(/* webpackIgnore: true */ path)
      .then(async (m: { default: (path?: string) => Promise<unknown>; check_quote: (i: unknown) => unknown }) => {
        await m.default("/wasm/nimbros_quote_wasm_bg.wasm");
        mod = m;
      })
      .catch(() => { mod = null; }); // best-effort: the UI works fine without this check
  }
  return loading;
}

/** Reserves and fee come from the row's own pool data (DexScreener), never from the aggregator being checked. */
export async function checkQuote(a: { reserveIn: bigint; reserveOut: bigint; feeBps: number; amountIn: bigint; quotedOut: bigint }): Promise<QuoteCheck | null> {
  await ensureLoaded();
  if (!mod) return null;
  try {
    const r = mod.check_quote({
      reserve_in: a.reserveIn.toString(), reserve_out: a.reserveOut.toString(), fee_bps: a.feeBps,
      amount_in: a.amountIn.toString(), quoted_out: a.quotedOut.toString(),
    }) as { ok: boolean; local_out: string; diff_bps: number; error?: string };
    return { ok: r.ok, localOut: BigInt(r.local_out || "0"), diffBps: r.diff_bps, error: r.error };
  } catch {
    return null;
  }
}
