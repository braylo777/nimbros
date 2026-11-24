//! Follows Cetus swap events on mainnet: seed with the latest few hundred, then poll forward from the last cursor about once a second.

use crate::events::{parse_node, Swap, CETUS_SWAP_EVENT};
use crate::meta::GQL;
use serde_json::{json, Value};

pub struct Page {
    pub swaps: Vec<Swap>,
    pub start_cursor: Option<String>,
    pub end_cursor: Option<String>,
    pub has_next: bool,
    pub has_prev: bool,
}

fn parse_page(v: &Value) -> Option<Page> {
    let ev = v.get("data")?.get("events")?;
    let swaps = ev.get("nodes")?.as_array()?.iter().filter_map(parse_node).collect();
    let pi = ev.get("pageInfo")?;
    Some(Page {
        swaps,
        start_cursor: pi.get("startCursor").and_then(|c| c.as_str()).map(String::from),
        end_cursor: pi.get("endCursor").and_then(|c| c.as_str()).map(String::from),
        has_next: pi.get("hasNextPage").and_then(|b| b.as_bool()).unwrap_or(false),
        has_prev: pi.get("hasPreviousPage").and_then(|b| b.as_bool()).unwrap_or(false),
    })
}

const FIELDS: &str = "pageInfo{hasNextPage hasPreviousPage startCursor endCursor} nodes{timestamp transaction{digest} contents{json}}";

/// The newest 50 swaps (Sui GraphQL caps a page at 50), oldest first.
pub async fn latest(client: &reqwest::Client) -> Option<Page> {
    let q = format!("query{{events(last:50,filter:{{type:\"{CETUS_SWAP_EVENT}\"}}){{{FIELDS}}}}}");
    let v: Value = client.post(GQL).json(&json!({ "query": q })).send().await.ok()?.json().await.ok()?;
    parse_page(&v)
}

/// The 50 swaps just before `cursor`, for backfilling history at start-up.
pub async fn before(client: &reqwest::Client, cursor: &str) -> Option<Page> {
    let q = format!("query($c:String){{events(last:50,before:$c,filter:{{type:\"{CETUS_SWAP_EVENT}\"}}){{{FIELDS}}}}}");
    let v: Value = client.post(GQL).json(&json!({ "query": q, "variables": { "c": cursor } })).send().await.ok()?.json().await.ok()?;
    parse_page(&v)
}

/// Swaps after `cursor`, up to 50.
pub async fn after(client: &reqwest::Client, cursor: &str) -> Option<Page> {
    let q = format!("query($c:String){{events(first:50,after:$c,filter:{{type:\"{CETUS_SWAP_EVENT}\"}}){{{FIELDS}}}}}");
    let v: Value = client.post(GQL).json(&json!({ "query": q, "variables": { "c": cursor } })).send().await.ok()?.json().await.ok()?;
    parse_page(&v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_graphql_page_becomes_swaps_and_a_cursor() {
        let v = json!({"data":{"events":{
            "pageInfo":{"hasNextPage":true,"endCursor":"abc"},
            "nodes":[
              {"timestamp":"2026-09-23T22:15:48.468Z","transaction":{"digest":"d1"},"contents":{"json":{"atob":true,"pool":"0xp","amount_in":"10","amount_out":"5","fee_amount":"1","before_sqrt_price":"100","after_sqrt_price":"99"}}},
              {"timestamp":"bad","transaction":{"digest":"d2"},"contents":{"json":{}}}
            ]}}});
        let p = parse_page(&v).unwrap();
        assert_eq!(p.swaps.len(), 1); // the malformed node is dropped, not guessed
        assert_eq!(p.end_cursor.as_deref(), Some("abc"));
        assert!(p.has_next);
        assert!(parse_page(&json!({"errors":[]})).is_none());
    }
}
