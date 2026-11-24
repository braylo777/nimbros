//! Walks a Solana pool's transaction history forward from a cursor, over plain JSON-RPC (any provider — the app's own Helius endpoint
//! works here too), turning each one into a `Swap` via `sol_swap`. No paid Geyser/gRPC stream required: this is a polling design, so it
//! costs one `getSignaturesForAddress` call per pass plus one `getTransaction` per NEW signature since the last pass.

use crate::sol_swap::{swap_from_transaction, Swap};
use serde_json::{json, Value};

pub struct Page {
    pub swaps: Vec<Swap>,
    /// the newest signature seen this page; pass as `until` next time to fetch only what's new
    pub newest_signature: Option<String>,
}

async fn rpc(client: &reqwest::Client, rpc_url: &str, method: &str, params: Value) -> Option<Value> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let r = client.post(rpc_url).json(&body).send().await.ok()?;
    let j: Value = r.json().await.ok()?;
    if j.get("error").is_some() {
        return None;
    }
    j.get("result").cloned()
}

/// Signatures newer than `until` (exclusive), oldest-fetched-last as Solana returns them (newest first) — `before` walks further back,
/// `until` stops once we reach something already seen. Solana caps a page at 1000; we ask for far fewer since this polls often.
async fn signatures_since(client: &reqwest::Client, rpc_url: &str, address: &str, until: Option<&str>) -> Vec<String> {
    let mut params = json!([address, { "limit": 100 }]);
    if let Some(u) = until {
        params[1]["until"] = json!(u);
    }
    rpc(client, rpc_url, "getSignaturesForAddress", params)
        .await
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter(|s| s["err"].is_null()) // a failed transaction never moved the pool; skip the extra fetch entirely
        .filter_map(|s| s["signature"].as_str().map(String::from))
        .collect()
}

async fn get_transaction(client: &reqwest::Client, rpc_url: &str, signature: &str) -> Option<Value> {
    rpc(client, rpc_url, "getTransaction", json!([signature, { "encoding": "json", "maxSupportedTransactionVersion": 0 }])).await
}

/// One pass: everything newer than `cursor` for this pool, oldest first, ready to fold into candles.
pub async fn poll(client: &reqwest::Client, rpc_url: &str, base_account: &str, quote_account: &str, cursor: Option<&str>) -> Page {
    // Solana returns signatures newest-first; reverse so swaps are folded into candles in chronological order.
    let mut sigs = signatures_since(client, rpc_url, base_account, cursor).await;
    sigs.reverse();
    let newest = sigs.last().cloned().or_else(|| cursor.map(String::from));
    let mut swaps = Vec::new();
    for sig in &sigs {
        let Some(tx) = get_transaction(client, rpc_url, sig).await else { continue }; // one dropped fetch never blocks the rest
        if let Ok(Some(s)) = swap_from_transaction(&tx, base_account, quote_account) {
            swaps.push(s);
        }
    }
    Page { swaps, newest_signature: newest }
}

// This module's own logic is the thin HTTP-calling part; it has no pure logic worth unit testing on its own (that's `sol_swap.rs`,
// which has 7 tests). Testing `poll()` itself needs a mocked RPC endpoint — real, but integration-level work, not done yet.
