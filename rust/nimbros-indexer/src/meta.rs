//! Which two coins a Cetus pool holds and their decimals, read once from Sui and cached.

use serde_json::{json, Value};
use std::collections::HashMap;

pub const GQL: &str = "https://graphql.mainnet.sui.io/graphql";

#[derive(Debug, Clone, PartialEq)]
pub struct PoolMeta {
    pub coin_a: String,
    pub coin_b: String,
    pub decimals_a: u32,
    pub decimals_b: u32,
}

/// `0x…::pool::Pool<0xA::a::A, 0xB::b::B>` -> ("0xA::a::A", "0xB::b::B")
pub fn parse_pool_type(repr: &str) -> Option<(String, String)> {
    let inner = repr.split_once('<')?.1.strip_suffix('>')?;
    // split on the top-level comma (coin types have no generics here, but be safe about nesting)
    let mut depth = 0;
    for (i, c) in inner.char_indices() {
        match c {
            '<' => depth += 1,
            '>' => depth -= 1,
            ',' if depth == 0 => return Some((inner[..i].trim().to_string(), inner[i + 1..].trim().to_string())),
            _ => {}
        }
    }
    None
}

async fn gql(client: &reqwest::Client, query: &str, vars: Value) -> Option<Value> {
    let r = client.post(GQL).json(&json!({ "query": query, "variables": vars })).send().await.ok()?;
    r.json::<Value>().await.ok()?.get("data").cloned()
}

pub async fn load(client: &reqwest::Client, pool: &str) -> Option<PoolMeta> {
    let d = gql(client, "query($a:SuiAddress!){object(address:$a){asMoveObject{contents{type{repr}}}}}", json!({ "a": pool })).await?;
    let repr = d["object"]["asMoveObject"]["contents"]["type"]["repr"].as_str()?;
    let (a, b) = parse_pool_type(repr)?;
    let dec = |c: String| {
        let client = client.clone();
        async move {
            let d = gql(&client, "query($t:String!){coinMetadata(coinType:$t){decimals}}", json!({ "t": c })).await?;
            d["coinMetadata"]["decimals"].as_u64().map(|x| x as u32)
        }
    };
    let (da, db) = tokio::join!(dec(a.clone()), dec(b.clone()));
    Some(PoolMeta { coin_a: a, coin_b: b, decimals_a: da?, decimals_b: db? })
}

#[derive(Default)]
pub struct MetaCache(pub HashMap<String, Option<PoolMeta>>);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pool_type_splits_into_its_two_coins() {
        let (a, b) = parse_pool_type("0x1eabed72::pool::Pool<0x2::sui::SUI, 0xdba3::usdc::USDC>").unwrap();
        assert_eq!(a, "0x2::sui::SUI");
        assert_eq!(b, "0xdba3::usdc::USDC");
        assert!(parse_pool_type("0x1::pool::Pool").is_none());
    }
}
