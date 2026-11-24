//! Cetus prices. A pool's price of token A in token B is `(sqrt_price / 2^64)^2`, adjusted for each token's decimals.

/// Price of A in B, in whole units of B per whole unit of A.
pub fn price_a_in_b(sqrt_price_x64: u128, decimals_a: u32, decimals_b: u32) -> f64 {
    let s = sqrt_price_x64 as f64 / 18_446_744_073_709_551_616.0; // 2^64
    let raw = s * s;
    raw * 10f64.powi(decimals_a as i32 - decimals_b as i32)
}

/// The traded price implied by a swap's own amounts (what the trader actually got), in whole B per whole A.
pub fn fill_price_a_in_b(a_to_b: bool, amount_in: u128, amount_out: u128, decimals_a: u32, decimals_b: u32) -> Option<f64> {
    if amount_in == 0 || amount_out == 0 {
        return None;
    }
    let (a, b) = if a_to_b { (amount_in, amount_out) } else { (amount_out, amount_in) };
    Some((b as f64 / 10f64.powi(decimals_b as i32)) / (a as f64 / 10f64.powi(decimals_a as i32)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqrt_price_of_one_is_a_price_of_one() {
        assert!((price_a_in_b(1u128 << 64, 9, 9) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn decimals_scale_the_price() {
        // same raw ratio, token A has 9 decimals and B has 6: one whole A is 1000 whole B
        assert!((price_a_in_b(1u128 << 64, 9, 6) - 1000.0).abs() < 1e-9);
    }

    #[test]
    fn the_fill_price_agrees_with_the_pool_price_within_the_fee_and_impact() {
        // real event: before/after sqrt price and amounts, both tokens taken as 9 decimals for the comparison
        let before = price_a_in_b(834_638_777_578_988_403, 9, 9);
        let after = price_a_in_b(834_564_499_446_251_097, 9, 9);
        let fill = fill_price_a_in_b(true, 173_556_060_037, 354_382_042, 9, 9).unwrap();
        assert!(after < before, "selling A pushes A's price down");
        assert!(fill <= before * 1.0001 && fill >= after * 0.99, "fill {fill} should sit between the pool price after ({after}) and before ({before}) it");
    }

    #[test]
    fn zero_amounts_have_no_price() {
        assert_eq!(fill_price_a_in_b(true, 0, 5, 9, 9), None);
    }
}
