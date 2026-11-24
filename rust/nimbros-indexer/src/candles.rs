//! OHLCV aggregation. A candle covers `[t0, t0 + width)`; a swap belongs to exactly one candle.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub struct Candle {
    pub t0_ms: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    /// volume in token B (the quote side), whole units
    pub volume: f64,
    pub trades: u32,
}

/// Builds candles from (timestamp, price, quote volume) points, oldest first or not: order is by time then insertion.
pub fn build(width_ms: i64, mut points: Vec<(i64, f64, f64)>) -> Vec<Candle> {
    points.sort_by_key(|p| p.0); // stable: same-millisecond swaps keep the order they arrived in
    let mut out: BTreeMap<i64, Candle> = BTreeMap::new();
    for (ts, price, vol) in points {
        if !price.is_finite() || price <= 0.0 {
            continue;
        }
        let t0 = ts.div_euclid(width_ms) * width_ms;
        out.entry(t0)
            .and_modify(|c| {
                c.high = c.high.max(price);
                c.low = c.low.min(price);
                c.close = price;
                c.volume += vol;
                c.trades += 1;
            })
            .or_insert(Candle { t0_ms: t0, open: price, high: price, low: price, close: price, volume: vol, trades: 1 });
    }
    out.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swaps_in_one_bucket_make_one_candle_with_the_right_ohlc() {
        let c = build(60_000, vec![(1_000, 10.0, 1.0), (2_000, 12.0, 2.0), (3_000, 9.0, 3.0), (4_000, 11.0, 4.0)]);
        assert_eq!(c.len(), 1);
        let k = &c[0];
        assert_eq!((k.open, k.high, k.low, k.close), (10.0, 12.0, 9.0, 11.0));
        assert_eq!(k.volume, 10.0);
        assert_eq!(k.trades, 4);
    }

    #[test]
    fn a_swap_on_the_boundary_belongs_to_the_later_candle() {
        let c = build(60_000, vec![(59_999, 1.0, 1.0), (60_000, 2.0, 1.0)]);
        assert_eq!(c.iter().map(|x| x.t0_ms).collect::<Vec<_>>(), vec![0, 60_000]);
    }

    #[test]
    fn out_of_order_input_is_sorted_and_bad_prices_are_dropped() {
        let c = build(1_000, vec![(2_500, 5.0, 1.0), (500, 4.0, 1.0), (600, f64::NAN, 1.0), (700, -1.0, 1.0), (900, 6.0, 1.0)]);
        assert_eq!(c.len(), 2);
        assert_eq!((c[0].open, c[0].close), (4.0, 6.0));
        assert_eq!(c[1].open, 5.0);
    }

    #[test]
    fn one_second_candles_work_the_same_way() {
        let c = build(1_000, vec![(1_100, 1.0, 1.0), (1_900, 2.0, 1.0), (2_000, 3.0, 1.0)]);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].close, 2.0);
    }
}
