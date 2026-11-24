//! Browser-side cross-check: before a swap is shown for review, recompute what a constant-product pool would actually pay from its OWN live
//! reserves (already fetched for the row, from DexScreener), and compare that to the aggregator's (Jupiter's) quote. Aggregators can be wrong,
//! stale, or route through a pool this check doesn't model — so a mismatch is a WARNING to look closer, never a block on its own, and this
//! never overrides Shield's on-chain simulation. It exists to catch the case an aggregator's price sits far from reality before a user signs.

use nimbros_quote::Cpmm;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
pub struct CheckInput {
    /// the pool's own reserves right now, smallest units, on the side being paid in and the side being paid out
    pub reserve_in: String,
    pub reserve_out: String,
    pub fee_bps: u32,
    pub amount_in: String,
    /// what the aggregator quoted for amount_out, smallest units
    pub quoted_out: String,
}

#[derive(Serialize)]
pub struct CheckResult {
    pub ok: bool,
    /// our own quote from the pool's current reserves
    pub local_out: String,
    /// how far the aggregator's quote sits from ours, in basis points (aggregator below local = positive; a big positive number means the
    /// aggregator is quoting noticeably worse than the pool's own state suggests)
    pub diff_bps: i64,
    pub error: Option<String>,
}

fn parse_u128(s: &str) -> Result<u128, ()> { s.parse::<u128>().map_err(|_| ()) }

/// Runs the check; never panics — a bad input becomes `{ok:false, error:...}`.
#[wasm_bindgen]
pub fn check_quote(input: JsValue) -> Result<JsValue, JsValue> {
    let inp: CheckInput = serde_wasm_bindgen::from_value(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let res = run(&inp);
    serde_wasm_bindgen::to_value(&res).map_err(|e| JsValue::from_str(&e.to_string()))
}

fn run(inp: &CheckInput) -> CheckResult {
    let bad = |msg: &str| CheckResult { ok: false, local_out: "0".into(), diff_bps: 0, error: Some(msg.into()) };
    let (Ok(reserve_in), Ok(reserve_out), Ok(amount_in), Ok(quoted_out)) =
        (parse_u128(&inp.reserve_in), parse_u128(&inp.reserve_out), parse_u128(&inp.amount_in), parse_u128(&inp.quoted_out))
    else { return bad("couldn't parse a number"); };
    let Ok(pool) = Cpmm::new(reserve_in, reserve_out, inp.fee_bps as u128) else { return bad("empty pool or bad fee") };
    let Ok(local_out) = pool.quote_out(amount_in) else { return bad("couldn't quote from these reserves") };
    if local_out == 0 { return CheckResult { ok: true, local_out: "0".into(), diff_bps: 0, error: None }; }
    // positive = the aggregator quoted less than our own pool math says it should pay right now
    let diff_bps = ((local_out as i128 - quoted_out as i128) * 10_000 / local_out as i128) as i64;
    CheckResult { ok: true, local_out: local_out.to_string(), diff_bps, error: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quote_that_matches_the_pool_shows_no_meaningful_difference() {
        let r = run(&CheckInput { reserve_in: "1000000000".into(), reserve_out: "2000000000".into(), fee_bps: 30, amount_in: "10000".into(), quoted_out: "19940".into() });
        assert!(r.ok);
        assert!(r.diff_bps.abs() <= 5, "diff_bps was {}", r.diff_bps);
    }

    #[test]
    fn a_quote_far_below_the_pool_s_own_math_is_flagged() {
        let r = run(&CheckInput { reserve_in: "1000000000".into(), reserve_out: "2000000000".into(), fee_bps: 30, amount_in: "10000".into(), quoted_out: "10000".into() });
        assert!(r.ok);
        assert!(r.diff_bps > 4000, "expected a large positive gap, got {}", r.diff_bps);
    }

    #[test]
    fn bad_numbers_never_panic() {
        let r = run(&CheckInput { reserve_in: "not a number".into(), reserve_out: "2".into(), fee_bps: 30, amount_in: "1".into(), quoted_out: "1".into() });
        assert!(!r.ok);
        assert!(r.error.is_some());
    }
}
