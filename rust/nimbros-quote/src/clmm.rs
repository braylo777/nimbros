//! Concentrated-liquidity (Cetus / Uniswap-v3 style) swap math in Q64.64 sqrt prices, exact integer arithmetic on 256-bit intermediates.
//!
//! The pool is described as ranges of constant liquidity between sqrt-price boundaries (the boundaries are the initialised ticks' `sqrt_price`
//! values, which the chain stores, so no tick math is needed here). A swap walks the ranges from the current price, exactly as the pool does.

use ruint::aliases::U256;

const Q: u128 = 1u128 << 64;
pub const FEE_DENOM: u128 = 1_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Range {
    pub sqrt_lo: u128,
    pub sqrt_hi: u128,
    /// active liquidity while the price is inside [sqrt_lo, sqrt_hi]
    pub liquidity: u128,
}

#[derive(Clone, Debug)]
pub struct Clmm {
    pub sqrt_price: u128,
    /// ascending, non-overlapping
    pub ranges: Vec<Range>,
    /// fee in parts per million, taken from the input
    pub fee_ppm: u128,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Quote {
    pub amount_in_used: u128,
    pub amount_out: u128,
    pub fee: u128,
    pub sqrt_after: u128,
    /// false when the pool ran out of liquidity before the whole input was used
    pub filled: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ClmmError {
    ZeroAmount,
    PriceOutsideRanges,
    InvalidFee,
    Overflow,
}

fn u(x: u128) -> U256 {
    U256::from(x)
}
fn to_u128(x: U256) -> Result<u128, ClmmError> {
    u128::try_from(x).map_err(|_| ClmmError::Overflow)
}
fn div_up(a: U256, b: U256) -> U256 {
    (a + b - U256::from(1u8)) / b
}

/// Token A needed to move the price between two sqrt prices at liquidity `l`: L * Q * (hi - lo) / (hi * lo).
fn amount_a(lo: u128, hi: u128, l: u128, round_up: bool) -> Result<u128, ClmmError> {
    let num = u(l) * u(Q) * u(hi - lo);
    let den = u(hi) * u(lo);
    to_u128(if round_up { div_up(num, den) } else { num / den })
}

/// Token B needed to move the price between two sqrt prices: L * (hi - lo) / Q.
fn amount_b(lo: u128, hi: u128, l: u128, round_up: bool) -> Result<u128, ClmmError> {
    let num = u(l) * u(hi - lo);
    to_u128(if round_up { div_up(num, u(Q)) } else { num / u(Q) })
}

impl Clmm {
    fn range_of(&self, sqrt: u128, a_to_b: bool) -> Option<usize> {
        // selling A moves the price down: when sitting exactly on a boundary use the range below it; selling B, the range above
        self.ranges.iter().position(|r| if a_to_b { sqrt > r.sqrt_lo && sqrt <= r.sqrt_hi } else { sqrt >= r.sqrt_lo && sqrt < r.sqrt_hi })
    }

    /// Quote selling `amount_in` of token A (`a_to_b`) or token B, walking every range the trade crosses.
    pub fn quote(&self, amount_in: u128, a_to_b: bool) -> Result<Quote, ClmmError> {
        if amount_in == 0 {
            return Err(ClmmError::ZeroAmount);
        }
        if self.fee_ppm >= FEE_DENOM {
            return Err(ClmmError::InvalidFee);
        }
        let mut cur = self.sqrt_price;
        let mut idx = self.range_of(cur, a_to_b).ok_or(ClmmError::PriceOutsideRanges)? as isize;
        let (mut left, mut out, mut fee_total) = (amount_in, 0u128, 0u128);
        while left > 0 {
            let Some(r) = usize::try_from(idx).ok().and_then(|i| self.ranges.get(i)) else { break };
            let target = if a_to_b { r.sqrt_lo } else { r.sqrt_hi };
            if r.liquidity == 0 {
                cur = target;
            } else {
                // input (after fee) available for this step
                let avail = to_u128(u(left) * u(FEE_DENOM - self.fee_ppm) / u(FEE_DENOM))?;
                let to_target = if a_to_b { amount_a(target, cur, r.liquidity, true)? } else { amount_b(cur, target, r.liquidity, true)? };
                if avail >= to_target {
                    // the whole range is crossed
                    let gross = to_u128(div_up(u(to_target) * u(FEE_DENOM), u(FEE_DENOM - self.fee_ppm)))?.min(left);
                    fee_total += gross - to_target;
                    left -= gross;
                    out += if a_to_b { amount_b(target, cur, r.liquidity, false)? } else { amount_a(cur, target, r.liquidity, false)? };
                    cur = target;
                } else {
                    // the trade ends inside this range
                    let next = if a_to_b {
                        // sqrt_next = L*Q*cur / (L*Q + a*cur), rounded up so the pool never over-pays
                        let num = u(r.liquidity) * u(Q) * u(cur);
                        let den = u(r.liquidity) * u(Q) + u(avail) * u(cur);
                        to_u128(div_up(num, den))?
                    } else {
                        cur + to_u128(u(avail) * u(Q) / u(r.liquidity))?
                    };
                    out += if a_to_b { amount_b(next, cur, r.liquidity, false)? } else { amount_a(cur, next, r.liquidity, false)? };
                    fee_total += left - avail;
                    left = 0;
                    cur = next;
                }
            }
            idx += if a_to_b { -1 } else { 1 };
        }
        Ok(Quote { amount_in_used: amount_in - left, amount_out: out, fee: fee_total, sqrt_after: cur, filled: left == 0 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Cpmm;

    const L: u128 = 1_000_000_000_000_000;
    fn one_range(sqrt: u128) -> Clmm {
        Clmm { sqrt_price: sqrt, ranges: vec![Range { sqrt_lo: sqrt / 2, sqrt_hi: sqrt * 2, liquidity: L }], fee_ppm: 3_000 }
    }

    #[test]
    fn inside_one_range_it_is_a_constant_product_pool_on_virtual_reserves() {
        let sqrt = Q; // price 1
        let pool = one_range(sqrt);
        // virtual reserves: x = L*Q/sqrt (token A), y = L*sqrt/Q (token B)
        let x = L * Q / sqrt;
        let y = L * sqrt / Q;
        let cp = Cpmm::new(x, y, 30).unwrap();
        for a in [1_000_000u128, 1_000_000_000, 50_000_000_000_000] {
            let c = pool.quote(a, true).unwrap();
            let want = cp.quote_out(a).unwrap();
            let diff = c.amount_out.abs_diff(want);
            assert!(diff <= 2, "a={a}: clmm {} vs cpmm {want}", c.amount_out);
            assert!(c.filled);
        }
    }

    #[test]
    fn selling_a_lowers_the_price_and_selling_b_raises_it() {
        let p = one_range(Q);
        assert!(p.quote(1_000_000_000, true).unwrap().sqrt_after < Q);
        assert!(p.quote(1_000_000_000, false).unwrap().sqrt_after > Q);
    }

    #[test]
    fn crossing_into_a_thinner_range_pays_less_than_staying_in_a_deep_one() {
        let deep = Clmm { sqrt_price: Q, ranges: vec![Range { sqrt_lo: Q / 2, sqrt_hi: Q * 2, liquidity: L }], fee_ppm: 3_000 };
        let thin = Clmm {
            sqrt_price: Q,
            ranges: vec![Range { sqrt_lo: Q / 2, sqrt_hi: Q - Q / 100, liquidity: L / 100 }, Range { sqrt_lo: Q - Q / 100, sqrt_hi: Q * 2, liquidity: L }],
            fee_ppm: 3_000,
        };
        let a = 400_000_000_000_000u128; // enough to cross the 1% boundary
        assert!(thin.quote(a, true).unwrap().amount_out < deep.quote(a, true).unwrap().amount_out);
    }

    #[test]
    fn output_is_monotonic_and_the_pool_can_run_out_of_liquidity() {
        let p = one_range(Q);
        let mut last = 0;
        for a in [1u128, 1_000, 1_000_000_000, 100_000_000_000_000, 10_000_000_000_000_000] {
            let o = p.quote(a, true).unwrap().amount_out;
            assert!(o >= last);
            last = o;
        }
        let huge = p.quote(u128::MAX / 1_000_000, true);
        assert!(matches!(huge, Ok(q) if !q.filled));
    }

    #[test]
    fn fee_plus_swapped_input_adds_up_to_what_was_used() {
        let p = one_range(Q);
        let q = p.quote(10_000_000_000_000, false).unwrap();
        assert_eq!(q.amount_in_used, 10_000_000_000_000);
        assert!(q.fee > 0 && q.fee < q.amount_in_used / 100); // 0.3% fee
    }

    #[test]
    fn bad_input_is_refused() {
        let p = one_range(Q);
        assert_eq!(p.quote(0, true), Err(ClmmError::ZeroAmount));
        let outside = Clmm { sqrt_price: Q * 10, ranges: p.ranges.clone(), fee_ppm: 3_000 };
        assert_eq!(outside.quote(5, true), Err(ClmmError::PriceOutsideRanges));
        assert_eq!(Clmm { fee_ppm: FEE_DENOM, ..p }.quote(5, true), Err(ClmmError::InvalidFee));
    }
}
