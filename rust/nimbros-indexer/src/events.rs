//! Cetus `pool::SwapEvent`, as returned by Sui's GraphQL `events` query.

use serde::Deserialize;
use serde_json::Value;

/// The mainnet Cetus CLMM package that emits swap events.
pub const CETUS_SWAP_EVENT: &str = "0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::pool::SwapEvent";

#[derive(Debug, Clone, PartialEq)]
pub struct Swap {
    pub pool: String,
    pub digest: String,
    pub ts_ms: i64,
    /// true: token A was sold for token B
    pub a_to_b: bool,
    pub amount_in: u128,
    pub amount_out: u128,
    pub fee: u128,
    pub sqrt_before: u128,
    pub sqrt_after: u128,
}

#[derive(Deserialize)]
struct Json {
    atob: bool,
    pool: String,
    amount_in: String,
    amount_out: String,
    fee_amount: String,
    before_sqrt_price: String,
    after_sqrt_price: String,
}

/// Parses ISO-8601 UTC like `2026-09-23T22:15:48.468Z` into unix milliseconds.
pub fn parse_ts_ms(s: &str) -> Option<i64> {
    let (date, time) = s.trim_end_matches('Z').split_once('T')?;
    let mut d = date.split('-').map(|x| x.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let (hms, ms) = time.split_once('.').unwrap_or((time, "0"));
    let mut t = hms.split(':').map(|x| x.parse::<i64>().ok());
    let (hh, mm, ss) = (t.next()??, t.next()??, t.next()??);
    // days since 1970-01-01 (civil-from-days inverse, Howard Hinnant)
    let (y2, m2) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let ms3: i64 = format!("{:0<3}", ms).get(..3)?.parse().ok()?;
    Some(((days * 24 + hh) * 60 + mm) * 60_000 + ss * 1000 + ms3)
}

/// One GraphQL event node -> a Swap. Anything malformed is skipped (returns None), never guessed.
pub fn parse_node(node: &Value) -> Option<Swap> {
    let j: Json = serde_json::from_value(node.get("contents")?.get("json")?.clone()).ok()?;
    Some(Swap {
        pool: j.pool,
        digest: node.get("transaction")?.get("digest")?.as_str()?.to_string(),
        ts_ms: parse_ts_ms(node.get("timestamp")?.as_str()?)?,
        a_to_b: j.atob,
        amount_in: j.amount_in.parse().ok()?,
        amount_out: j.amount_out.parse().ok()?,
        fee: j.fee_amount.parse().ok()?,
        sqrt_before: j.before_sqrt_price.parse().ok()?,
        sqrt_after: j.after_sqrt_price.parse().ok()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_parse_to_unix_milliseconds() {
        assert_eq!(parse_ts_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_ts_ms("2000-03-01T00:00:01.5Z"), Some(951_868_801_500));
        assert_eq!(parse_ts_ms("2026-09-23T22:15:48.468Z"), Some(1_790_201_748_468));
        assert_eq!(parse_ts_ms("not a time"), None);
    }

    #[test]
    fn a_real_cetus_event_parses() {
        // taken from mainnet
        let node = serde_json::json!({
            "timestamp": "2026-09-23T22:15:48.468Z",
            "transaction": { "digest": "ET2MKtHNUdMjKtFRg6gUqMKNKqVLxRhm2zapU5isuEDR" },
            "contents": { "json": {
                "atob": true, "pool": "0x4edb54baafdf02a2219b6c327c9acacd79280b9c98cdc1b2b23230de906fa421",
                "amount_in": "173556060037", "amount_out": "354382042", "fee_amount": "433890151",
                "before_sqrt_price": "834638777578988403", "after_sqrt_price": "834564499446251097"
            }}
        });
        let s = parse_node(&node).unwrap();
        assert!(s.a_to_b);
        assert_eq!(s.amount_in, 173_556_060_037);
        assert_eq!(s.sqrt_after, 834_564_499_446_251_097);
        assert_eq!(s.ts_ms, 1_790_201_748_468);
    }

    #[test]
    fn a_malformed_event_is_skipped_not_guessed() {
        assert!(parse_node(&serde_json::json!({"timestamp":"x"})).is_none());
        assert!(parse_node(&serde_json::json!({"timestamp":"2026-09-23T22:15:48.468Z","transaction":{"digest":"d"},"contents":{"json":{"atob":true,"pool":"p","amount_in":"NaN","amount_out":"1","fee_amount":"1","before_sqrt_price":"1","after_sqrt_price":"1"}}})).is_none());
    }
}
