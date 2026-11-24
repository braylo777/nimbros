# NimBros: agentic memecoin trading on Solana

One terminal for every Solana memecoin launchpad (pump.fun, bonk.fun, Moonshot, Meteora, Raydium LaunchLab and more), with safety
checks on every coin and non-custodial one-tap swaps routed by Jupiter. Agents trade through an MCP server, a REST API and a C++ CLI.

Next.js (static export) + Cloudflare Pages Functions. Read `.claude/brain/solana-migration.md` first: it explains the layout, the RPC
constraint and the deploy quirks. (Next 16 has breaking changes: see `AGENTS.md`.)

## Develop

```bash
npm install
npm test          # ~250 offline tests (node:test)
npm run build     # static export to ./out
npx wrangler pages dev out --compatibility-flag=nodejs_compat   # site + /api/* functions on :8788
```

`npm run dev` serves the UI only (no `/api/*`).

## Configuration (`wrangler.toml` + Pages secrets)

| Name | What it does |
| --- | --- |
| `SOLANA_RPC_URL` | Solana JSON-RPC endpoint for every server-side chain read and for the wallet's `/api/rpc` proxy. Needs a provider that allows indexed reads (Helius, Triton, QuickNode) for holder rows, sell-check and snipers. Set as a Pages **secret** when it carries a key. |
| `TREASURY_ADDRESS` | Solana wallet that receives the platform fee (15 bps on agent spot trades). Fee stays 0 until this is a valid address. |
| `AGENT_ALLOWLIST` / D1 `approved_wallets` | Wallets approved for agent trading, with caps. |
| `REAL_AGENT_TRADING` | `"1"` to allow building agent trades at all. Kill switch: KV key `killswitch`. |
| `JUPITER_API_KEY`, `JUPITER_API_URL` | Optional: a Jupiter key / their paid endpoint instead of the keyless `lite-api`. |
| `CRON_SECRET` | Shared with `worker/cron`, which calls `/api/cron/feeds` and `/api/cron/tick`. |
| `MOONPAY_PUBLIC_KEY`, `MOONPAY_SECRET_KEY` | Optional SOL on-ramp. |

Bindings: KV `FEEDS`, D1 `DB` (schema in `db/schema.sql`).

## Deploy

Build and deploy from a copy that has no macOS `._*` files (see the brain note), then:

```bash
npx wrangler pages deploy out --project-name x-nimbros-si --branch <branch>
```

## Agent client

`public/cli/nimbros.cpp` (C++17, libcurl only). `c++ -std=c++17 -O2 nimbros.cpp -lcurl -o nimbros && ./nimbros selftest`.

## Docs, tests, stats

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Tests: `npm test` (Node 24), `cargo test --manifest-path rust/Cargo.toml`, C++ CLI self-test via `cmake -S public/cli -B build && ctest --test-dir build`
- Stats: `npm run stats` writes `public/stats.json` {launchpads, coins_live, vol_24h, as_of}
- Secrets: copy `.env.example`; never commit real values
