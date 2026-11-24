//! Local quote engine. Everything is integer math on u128 (no floats near money), so a quote here is exactly what the pool would pay.
//!
//! A quote from live pool state, computed in microseconds, replaces a round trip to an aggregator. It also lets the executor size a trade
//! against actual depth and set `min_out` from the quote, not from a fixed guess.

pub mod clmm;

pub const BPS: u128 = 10_000;

/// A constant-product pool (x * y = k) with a fee taken from the input, as Uniswap-v2 style pools do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cpmm {
    pub reserve_in: u128,
    pub reserve_out: u128,
    /// Fee in basis points, taken from `amount_in` before it enters the curve.
    pub fee_bps: u128,
}

#[derive(Debug, PartialEq, Eq)]
pub enum QuoteError {
    ZeroAmount,
    EmptyPool,
    Overflow,
    InvalidFee,
}

impl Cpmm {
    pub fn new(reserve_in: u128, reserve_out: u128, fee_bps: u128) -> Result<Self, QuoteError> {
        if reserve_in == 0 || reserve_out == 0 {
            return Err(QuoteError::EmptyPool);
        }
        if fee_bps >= BPS {
            return Err(QuoteError::InvalidFee);
        }
        Ok(Self { reserve_in, reserve_out, fee_bps })
    }

    /// Output for `amount_in`, rounded down (the pool never pays a unit too many).
    pub fn quote_out(&self, amount_in: u128) -> Result<u128, QuoteError> {
        if amount_in == 0 {
            return Err(QuoteError::ZeroAmount);
        }
        let eff = amount_in.checked_mul(BPS - self.fee_bps).ok_or(QuoteError::Overflow)?; // amount_in * (1 - fee), scaled by BPS
        let num = eff.checked_mul(self.reserve_out).ok_or(QuoteError::Overflow)?;
        let den = self.reserve_in.checked_mul(BPS).ok_or(QuoteError::Overflow)?.checked_add(eff).ok_or(QuoteError::Overflow)?;
        Ok(num / den)
    }

    /// Input needed to receive exactly `amount_out` (rounded up). None if the pool cannot pay that much.
    pub fn quote_in(&self, amount_out: u128) -> Option<u128> {
        if amount_out == 0 || amount_out >= self.reserve_out {
            return None;
        }
        let num = self.reserve_in.checked_mul(amount_out)?.checked_mul(BPS)?;
        let den = (self.reserve_out - amount_out).checked_mul(BPS - self.fee_bps)?;
        Some(num / den + 1)
    }

    /// Price impact of trading `amount_in`, in basis points versus the pool's current spot price (fee included, so it is the true cost of the trade).
    pub fn impact_bps(&self, amount_in: u128) -> Result<u128, QuoteError> {
        let out = self.quote_out(amount_in)?;
        // ideal output at spot = amount_in * reserve_out / reserve_in
        let ideal = amount_in.checked_mul(self.reserve_out).ok_or(QuoteError::Overflow)? / self.reserve_in;
        if ideal == 0 || out >= ideal {
            return Ok(0);
        }
        Ok((ideal - out) * BPS / ideal)
    }

    /// The largest input whose impact stays within `max_impact_bps`. Binary search on the exact integer quote.
    pub fn max_in_for_impact(&self, max_impact_bps: u128) -> u128 {
        let (mut lo, mut hi) = (0u128, self.reserve_in.saturating_mul(1000));
        while lo < hi {
            let mid = lo + (hi - lo).div_ceil(2);
            match self.impact_bps(mid) {
                Ok(i) if i <= max_impact_bps => lo = mid,
                _ => hi = mid - 1,
            }
        }
        lo
    }

    /// State after selling `amount_in` into the pool (fee stays in the pool, as it does on chain).
    pub fn after_swap(&self, amount_in: u128) -> Result<Self, QuoteError> {
        let out = self.quote_out(amount_in)?;
        Ok(Self { reserve_in: self.reserve_in + amount_in, reserve_out: self.reserve_out - out, fee_bps: self.fee_bps })
    }
}

/// The least the trade should return: the quote minus `slippage_bps`, rounded down and never zero for a non-zero quote.
pub fn min_out(expected: u128, slippage_bps: u128) -> u128 {
    if expected == 0 {
        return 0;
    }
    let keep = BPS.saturating_sub(slippage_bps.min(BPS));
    (expected * keep / BPS).max(1)
}

/// Splits `amount_in` across several pools to maximise the total output. Greedy in `steps` equal slices, each sent to whichever pool pays
/// the most for it at its current state; exact for constant-product pools as `steps` grows. Returns (per-pool input, total output).
pub fn best_split(pools: &[Cpmm], amount_in: u128, steps: u32) -> Result<(Vec<u128>, u128), QuoteError> {
    if amount_in == 0 {
        return Err(QuoteError::ZeroAmount);
    }
    if pools.is_empty() {
        return Err(QuoteError::EmptyPool);
    }
    let steps = steps.max(1) as u128;
    let slice = (amount_in / steps).max(1);
    let mut state: Vec<Cpmm> = pools.to_vec();
    let mut given = vec![0u128; pools.len()];
    let mut left = amount_in;
    while left > 0 {
        let a = slice.min(left);
        let mut best = (0usize, 0u128);
        for (i, p) in state.iter().enumerate() {
            let out = p.quote_out(a).unwrap_or(0);
            if out > best.1 {
                best = (i, out);
            }
        }
        state[best.0] = state[best.0].after_swap(a).unwrap_or(state[best.0]);
        given[best.0] += a;
        left -= a;
    }
    // total is what each pool actually pays for its whole share, from its starting state
    let total = pools.iter().zip(&given).map(|(p, g)| if *g == 0 { 0 } else { p.quote_out(*g).unwrap_or(0) }).sum();
    Ok((given, total))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool() -> Cpmm {
        Cpmm::new(1_000_000_000_000, 500_000_000_000, 30).unwrap() // 1,000 SUI vs 500 units, 0.30% fee
    }

    #[test]
    fn matches_the_uniswap_v2_formula_exactly() {
        // out = in*997*ro / (ri*1000 + in*997)
        let p = Cpmm::new(1_000_000, 2_000_000, 30).unwrap();
        let a = 10_000u128;
        let want = a * 997 * 2_000_000 / (1_000_000 * 1000 + a * 997);
        assert_eq!(p.quote_out(a).unwrap(), want);
    }

    #[test]
    fn the_pool_never_pays_out_more_than_the_invariant_allows() {
        let p = pool();
        for a in [1u128, 1_000, 1_000_000, 50_000_000_000, 900_000_000_000] {
            let s = p.after_swap(a).unwrap();
            assert!(s.reserve_in * s.reserve_out >= p.reserve_in * p.reserve_out, "k must not shrink for {a}");
        }
    }

    #[test]
    fn output_grows_with_input_and_impact_grows_too() {
        let p = pool();
        let (mut last_out, mut last_imp) = (0, 0);
        for a in [1_000_000u128, 10_000_000, 100_000_000, 1_000_000_000, 10_000_000_000, 100_000_000_000] {
            let (o, i) = (p.quote_out(a).unwrap(), p.impact_bps(a).unwrap());
            assert!(o >= last_out && i >= last_imp);
            (last_out, last_imp) = (o, i);
        }
    }

    #[test]
    fn a_tiny_trade_costs_about_the_fee_and_a_huge_one_costs_much_more() {
        let p = pool();
        let small = p.impact_bps(1_000_000).unwrap();
        assert!((29..=31).contains(&small), "small trade impact {small} bps should be about the 30 bps fee");
        assert!(p.impact_bps(500_000_000_000).unwrap() > 3000);
    }

    #[test]
    fn quote_in_is_the_inverse_and_rounds_against_the_trader() {
        let p = pool();
        let want_out = 1_234_567_890u128;
        let need = p.quote_in(want_out).unwrap();
        assert!(p.quote_out(need).unwrap() >= want_out); // paying `need` gets at least what was asked
        assert!(p.quote_out(need - 1).unwrap() < want_out); // and one less would fall short
        assert!(p.quote_in(p.reserve_out).is_none());
    }

    #[test]
    fn max_in_for_impact_is_the_exact_boundary() {
        let p = pool();
        let m = p.max_in_for_impact(100); // 1%
        assert!(p.impact_bps(m).unwrap() <= 100);
        assert!(p.impact_bps(m + 1).unwrap() > 100 || m == 0);
    }

    #[test]
    fn min_out_rounds_down_and_is_never_zero_for_a_live_quote() {
        assert_eq!(min_out(10_000, 50), 9_950);
        assert_eq!(min_out(1, 300), 1);
        assert_eq!(min_out(0, 50), 0);
        assert_eq!(min_out(1000, 20_000), 1); // absurd slippage is clamped, still not zero
    }

    #[test]
    fn bad_input_is_refused_not_wrapped() {
        assert_eq!(Cpmm::new(0, 5, 30), Err(QuoteError::EmptyPool));
        assert_eq!(Cpmm::new(5, 5, 10_000), Err(QuoteError::InvalidFee));
        assert_eq!(pool().quote_out(0), Err(QuoteError::ZeroAmount));
        assert_eq!(Cpmm::new(u128::MAX / 2, u128::MAX / 2, 30).unwrap().quote_out(u128::MAX / 2), Err(QuoteError::Overflow));
    }

    #[test]
    fn splitting_across_pools_beats_the_best_single_pool() {
        let a = Cpmm::new(1_000_000_000, 1_000_000_000, 30).unwrap();
        let b = Cpmm::new(800_000_000, 900_000_000, 30).unwrap();
        let amount = 300_000_000u128;
        let single = a.quote_out(amount).unwrap().max(b.quote_out(amount).unwrap());
        let (given, total) = best_split(&[a, b], amount, 200).unwrap();
        assert_eq!(given.iter().sum::<u128>(), amount);
        assert!(total > single, "split {total} should beat single {single}");
    }

    #[test]
    fn splitting_with_one_pool_is_just_that_pool() {
        let a = pool();
        let (given, total) = best_split(&[a], 5_000_000, 10).unwrap();
        assert_eq!(given, vec![5_000_000]);
        assert_eq!(total, a.quote_out(5_000_000).unwrap());
    }
}
