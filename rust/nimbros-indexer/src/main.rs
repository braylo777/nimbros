mod api;
mod candles;
mod events;
mod meta;
mod poller;
mod price;
mod sol_poller; // Solana replacement for `poller`+`events`+`meta` (Sui-specific); not yet wired into main() below — see .claude/brain/native-code.md
mod sol_swap;
mod store;

use std::{
    collections::HashMap,
    sync::{atomic::{AtomicI64, Ordering}, Arc},
    time::Duration,
};
use tokio::sync::Mutex;

const BACKFILL_PAGES: u32 = 40; // ~2,000 swaps of history at start-up

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8787);
    let db = std::env::var("INDEXER_DB").unwrap_or_else(|_| "nimbros-indexer.db".into());
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).user_agent("nimbros-indexer/0.1").build().expect("http client");
    let app = Arc::new(api::App {
        store: Mutex::new(store::Store::open(&db).expect("open database")),
        metas: Mutex::new(HashMap::new()),
        client: client.clone(),
        last_event_ms: AtomicI64::new(0),
    });

    // follow the chain
    let poll_app = app.clone();
    tokio::spawn(async move {
        let mut cursor: Option<String> = None;
        loop {
            let page = match &cursor {
                None => {
                    // first pass: newest page, then walk backwards a few pages so charts have some history immediately
                    let first = poller::latest(&client).await;
                    if let Some(f) = &first {
                        let mut back = f.start_cursor.clone();
                        let mut has_prev = f.has_prev;
                        for _ in 0..BACKFILL_PAGES {
                            let (Some(c), true) = (back.clone(), has_prev) else { break };
                            let Some(p) = poller::before(&client, &c).await else { break };
                            let mut st = poll_app.store.lock().await;
                            for s in p.swaps { st.add(s); }
                            back = p.start_cursor;
                            has_prev = p.has_prev;
                        }
                    }
                    first
                }
                Some(c) => poller::after(&client, c).await,
            };
            let mut more = false;
            if let Some(p) = page {
                let mut st = poll_app.store.lock().await;
                for s in p.swaps {
                    poll_app.last_event_ms.fetch_max(s.ts_ms, Ordering::Relaxed);
                    st.add(s);
                }
                drop(st);
                if p.end_cursor.is_some() {
                    cursor = p.end_cursor;
                }
                more = p.has_next;
            }
            if !more {
                tokio::time::sleep(Duration::from_millis(1000)).await;
            }
        }
    });

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await.expect("bind");
    eprintln!("nimbros-indexer listening on :{port}");
    axum::serve(listener, api::router(app)).await.expect("serve");
}
