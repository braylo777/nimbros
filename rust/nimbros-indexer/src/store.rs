//! In-memory trade history per pool (recent only), with SQLite behind it so a restart doesn't start blind.

use crate::events::Swap;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet, VecDeque};

const KEEP_PER_POOL: usize = 20_000;

pub struct Store {
    pools: HashMap<String, VecDeque<Swap>>,
    seen: HashSet<String>,
    db: Connection,
}

impl Store {
    pub fn open(path: &str) -> rusqlite::Result<Self> {
        let db = Connection::open(path)?;
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS swaps (digest TEXT NOT NULL, pool TEXT NOT NULL, ts INTEGER NOT NULL, a_to_b INTEGER NOT NULL,
               amount_in TEXT NOT NULL, amount_out TEXT NOT NULL, fee TEXT NOT NULL, sqrt_before TEXT NOT NULL, sqrt_after TEXT NOT NULL,
               PRIMARY KEY (digest, pool, ts));
             CREATE INDEX IF NOT EXISTS swaps_pool_ts ON swaps (pool, ts);",
        )?;
        let mut s = Self { pools: HashMap::new(), seen: HashSet::new(), db };
        s.reload_recent()?;
        Ok(s)
    }

    fn reload_recent(&mut self) -> rusqlite::Result<()> {
        let mut rows: Vec<Swap> = Vec::new();
        {
            let mut st = self.db.prepare("SELECT digest, pool, ts, a_to_b, amount_in, amount_out, fee, sqrt_before, sqrt_after FROM swaps ORDER BY ts DESC LIMIT 200000")?;
            let it = st.query_map([], |r| {
                Ok(Swap {
                    digest: r.get(0)?,
                    pool: r.get(1)?,
                    ts_ms: r.get(2)?,
                    a_to_b: r.get::<_, i64>(3)? != 0,
                    amount_in: r.get::<_, String>(4)?.parse().unwrap_or(0),
                    amount_out: r.get::<_, String>(5)?.parse().unwrap_or(0),
                    fee: r.get::<_, String>(6)?.parse().unwrap_or(0),
                    sqrt_before: r.get::<_, String>(7)?.parse().unwrap_or(0),
                    sqrt_after: r.get::<_, String>(8)?.parse().unwrap_or(0),
                })
            })?;
            for x in it {
                rows.push(x?);
            }
        }
        rows.reverse();
        for s in rows {
            self.remember(s);
        }
        Ok(())
    }

    fn remember(&mut self, s: Swap) -> bool {
        let key = format!("{}:{}:{}", s.digest, s.pool, s.ts_ms);
        if !self.seen.insert(key) {
            return false;
        }
        let q = self.pools.entry(s.pool.clone()).or_default();
        q.push_back(s);
        if q.len() > KEEP_PER_POOL {
            q.pop_front();
        }
        true
    }

    /// Adds a swap; returns false if it was already known.
    pub fn add(&mut self, s: Swap) -> bool {
        let row = (s.digest.clone(), s.pool.clone(), s.ts_ms, s.a_to_b as i64, s.amount_in.to_string(), s.amount_out.to_string(), s.fee.to_string(), s.sqrt_before.to_string(), s.sqrt_after.to_string());
        if !self.remember(s) {
            return false;
        }
        let _ = self.db.execute("INSERT OR IGNORE INTO swaps VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7, row.8]);
        true
    }

    /// Newest first.
    pub fn trades(&self, pool: &str, limit: usize) -> Vec<Swap> {
        self.pools.get(pool).map(|q| q.iter().rev().take(limit).cloned().collect()).unwrap_or_default()
    }

    pub fn pool_ids(&self) -> Vec<String> {
        self.pools.keys().cloned().collect()
    }

    pub fn swap_count(&self) -> usize {
        self.pools.values().map(|q| q.len()).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn swap(d: &str, ts: i64) -> Swap {
        Swap { pool: "0xp".into(), digest: d.into(), ts_ms: ts, a_to_b: true, amount_in: 10, amount_out: 5, fee: 1, sqrt_before: 100, sqrt_after: 99 }
    }

    #[test]
    fn duplicates_are_ignored_and_trades_come_back_newest_first() {
        let mut s = Store::open(":memory:").unwrap();
        assert!(s.add(swap("a", 1)));
        assert!(!s.add(swap("a", 1)));
        assert!(s.add(swap("b", 2)));
        let t = s.trades("0xp", 10);
        assert_eq!(t.iter().map(|x| x.digest.as_str()).collect::<Vec<_>>(), vec!["b", "a"]);
        assert_eq!(s.swap_count(), 2);
        assert!(s.trades("0xother", 5).is_empty());
    }
}
