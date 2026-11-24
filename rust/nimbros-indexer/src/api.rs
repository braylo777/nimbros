//! HTTP API. Candle rows use the same shape as the site's chart (`t` in seconds, o/h/l/c/v), so the site can swap its price source to this.

use crate::{candles, meta, price, store::Store};
use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::HashMap,
    sync::{atomic::{AtomicI64, Ordering}, Arc},
};
use tokio::sync::Mutex;

pub struct App {
    pub store: Mutex<Store>,
    pub metas: Mutex<HashMap<String, Option<meta::PoolMeta>>>,
    pub client: reqwest::Client,
    pub last_event_ms: AtomicI64,
}

type Shared = Arc<App>;

#[derive(Deserialize)]
struct Q {
    res: Option<String>,
    limit: Option<usize>,
}

async fn meta_for(app: &App, pool: &str) -> Option<meta::PoolMeta> {
    if let Some(m) = app.metas.lock().await.get(pool) {
        return m.clone();
    }
    let m = meta::load(&app.client, pool).await;
    app.metas.lock().await.insert(pool.to_string(), m.clone());
    m
}

fn valid_pool(p: &str) -> bool {
    p.len() == 66 && p.starts_with("0x") && p[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

async fn health(State(app): State<Shared>) -> impl IntoResponse {
    let st = app.store.lock().await;
    let last = app.last_event_ms.load(Ordering::Relaxed);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    Json(json!({ "ok": true, "swaps": st.swap_count(), "pools": st.pool_ids().len(), "lastEventAgeMs": if last > 0 { now - last } else { -1 } }))
}

async fn pools(State(app): State<Shared>) -> impl IntoResponse {
    let st = app.store.lock().await;
    let mut v: Vec<_> = st.pool_ids().into_iter().map(|p| { let n = st.trades(&p, usize::MAX).len(); (p, n) }).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1));
    Json(json!(v.into_iter().map(|(p, n)| json!({ "pool": p, "swaps": n })).collect::<Vec<_>>()))
}

async fn trades(State(app): State<Shared>, Path(pool): Path<String>, Query(q): Query<Q>) -> impl IntoResponse {
    if !valid_pool(&pool) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad pool id" }))).into_response();
    }
    let m = meta_for(&app, &pool).await;
    let (da, db) = m.as_ref().map(|m| (m.decimals_a, m.decimals_b)).unwrap_or((0, 0));
    let rows = app.store.lock().await.trades(&pool, q.limit.unwrap_or(50).min(500));
    let out: Vec<_> = rows
        .iter()
        .map(|s| {
            let p = price::fill_price_a_in_b(s.a_to_b, s.amount_in, s.amount_out, da, db);
            json!({ "t": s.ts_ms / 1000, "side": if s.a_to_b { "sell" } else { "buy" }, "price": p, "tx": s.digest })
        })
        .collect();
    ([(header::CACHE_CONTROL, "public, max-age=1")], Json(json!({ "pool": pool, "coinA": m.as_ref().map(|m| &m.coin_a), "coinB": m.as_ref().map(|m| &m.coin_b), "trades": out }))).into_response()
}

async fn candles_route(State(app): State<Shared>, Path(pool): Path<String>, Query(q): Query<Q>) -> impl IntoResponse {
    if !valid_pool(&pool) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad pool id" }))).into_response();
    }
    let width = match q.res.as_deref().unwrap_or("1m") {
        "1s" => 1_000,
        "1m" => 60_000,
        "1h" => 3_600_000,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "res must be 1s, 1m or 1h" }))).into_response(),
    };
    let Some(m) = meta_for(&app, &pool).await else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "unknown pool" }))).into_response();
    };
    let swaps = app.store.lock().await.trades(&pool, 20_000);
    let pts = swaps
        .iter()
        .filter_map(|s| {
            let p = price::fill_price_a_in_b(s.a_to_b, s.amount_in, s.amount_out, m.decimals_a, m.decimals_b)?;
            let quote_raw = if s.a_to_b { s.amount_out } else { s.amount_in };
            Some((s.ts_ms, p, quote_raw as f64 / 10f64.powi(m.decimals_b as i32)))
        })
        .collect();
    let mut c = candles::build(width, pts);
    let keep = q.limit.unwrap_or(300).min(1000);
    if c.len() > keep {
        c.drain(..c.len() - keep);
    }
    let rows: Vec<_> = c.iter().map(|k| json!({ "t": k.t0_ms / 1000, "o": k.open, "h": k.high, "l": k.low, "c": k.close, "v": k.volume })).collect();
    ([(header::CACHE_CONTROL, "public, max-age=1")], Json(json!({ "pool": pool, "coinA": m.coin_a, "coinB": m.coin_b, "res": q.res.unwrap_or("1m".into()), "candles": rows }))).into_response()
}

pub fn router(app: Shared) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/pools", get(pools))
        .route("/pool/:id/trades", get(trades))
        .route("/pool/:id/candles", get(candles_route))
        .with_state(app)
}
