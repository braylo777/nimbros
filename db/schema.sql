CREATE TABLE IF NOT EXISTS agents (
  id        TEXT PRIMARY KEY,
  name_lc   TEXT NOT NULL UNIQUE,
  key_hash  TEXT NOT NULL UNIQUE,
  version   INTEGER NOT NULL DEFAULT 0,
  active    INTEGER NOT NULL DEFAULT 0, -- 1 when the account has alerts or queued webhook events
  data      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_active ON agents (active);

-- Real-money trade requests (kind = 'reserve': counted against the 24h cap when a transaction is built)
-- and confirmed on-chain results (kind = 'reported'). Doubles as the audit log for real trading.
CREATE TABLE IF NOT EXISTS real_ledger (
  id       TEXT PRIMARY KEY,
  ts       INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  address  TEXT NOT NULL,
  kind     TEXT NOT NULL,
  usd      REAL NOT NULL DEFAULT 0,
  digest   TEXT,
  detail   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS real_ledger_addr_ts ON real_ledger (address, ts);
CREATE UNIQUE INDEX IF NOT EXISTS real_ledger_digest ON real_ledger (digest) WHERE digest IS NOT NULL;

-- Who is looking at which coin right now: one row per browser tab, refreshed every 30 s, counted when seen in the last 60 s.
CREATE TABLE IF NOT EXISTS coin_views (
  coin TEXT NOT NULL,
  sid  TEXT NOT NULL,
  ts   INTEGER NOT NULL,
  PRIMARY KEY (coin, sid)
);
CREATE INDEX IF NOT EXISTS coin_views_ts ON coin_views (ts);

-- Small expiring counters (rate limits, product events). Lives in D1, not KV: KV's free tier allows 1,000 writes a day, and hitting it broke registration.
CREATE TABLE IF NOT EXISTS counters (
  k   TEXT PRIMARY KEY,
  n   INTEGER NOT NULL,
  exp INTEGER NOT NULL
);

-- Wallets approved for real agent trading, with their caps. Add or remove rows any time, no redeploy: scripts/agents.mjs.
CREATE TABLE IF NOT EXISTS approved_wallets (
  address      TEXT PRIMARY KEY,
  per_trade_usd REAL NOT NULL,
  daily_usd    REAL NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  ts           INTEGER NOT NULL
);

-- Feed cache (the finished Snipe/Scalp lists and the merged pool cache). D1 instead of KV: the scheduled worker rewrites these every 30 s,
-- which is far past KV's free 1,000 writes a day, and once that limit hit the site's lists went stale and registration broke.
CREATE TABLE IF NOT EXISTS blobs (
  k   TEXT PRIMARY KEY,
  v   TEXT NOT NULL,
  exp INTEGER NOT NULL DEFAULT 0
);
