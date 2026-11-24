# NimBros — disclosures (draft, pending counsel review)

Not legal advice, and **not reviewed by a lawyer**. This file records what the
app currently tells users, so counsel has one place to start.

## What the app does today (2026-09-26 — Solana; no paper/demo trading anywhere; every trade is real)
- **Human trading** — `components/SwapPanel.tsx` on every token page, `POST /api/swap/build`.
  Any connected Solana wallet can build, review, and sign a real swap (routed by Jupiter). **No allowlist and no caps on
  this path today** — this is the biggest open item below.
- **Agent trading** — the C++ CLI (`nimbros trade`) and MCP `build_trade`, `POST /api/trade/build`.
  Gated: the wallet must be linked to the agent and on `AGENT_ALLOWLIST`, and every trade is capped
  ($25/trade, $75/24h by default) and independently re-simulated before the agent signs.
- **Native launch (added 2026-09-28)** — the Launchpads tab has a form that builds an unsigned launch transaction (fixed supply minted once to the
  launcher, mint authority revoked, no freeze authority, immutable name/symbol). The launcher signs with their own wallet. **This changes the earlier
  "NimBros never launches a coin" position: needs counsel review before it is promoted.**
- **Launchpads** — NimBros indexes coins from third-party Solana launchpads (pump.fun, bonk.fun, Moonshot, Meteora,
  Raydium LaunchLab, …) and links out to them. NimBros does not launch, mint, or list a coin for anyone, and never holds keys,
  funds, or a coin. (The earlier Sui coin launcher was removed in the Solana migration.)
- In every case above: NimBros only ever builds and simulates an unsigned transaction. The wallet
  owner (human or agent) signs it themselves. Non-custodial throughout — no product surface holds
  keys or funds at rest.

## Disclosures shown in the app
- Agents tab: caps, the independent on-chain simulation check, the kill switch, and the fee, stated
  plainly before setup.
- SwapPanel: pay/receive amounts, price impact, and the platform fee (when configured) shown before
  the sign step; a Solana node simulated this exact transaction and it matched. Irreversible once you sign.
- "How this works" covers data sources, what the safety checks do and do not check (no holder
  concentration per wallet, only Jupiter's aggregate top-10 share), what the entry score is (a weighted microstructure
  read, explicitly not a probability), and that trading is irreversible and country-dependent.
- (The Launch review screen described in earlier drafts no longer exists.)

## Open questions for counsel
1. **Human swaps have no allowlist or caps today** — anyone with a wallet can trade any size, any
   coin we list, right now, in production. Is that acceptable to launch with, or does it need the
   same allowlist/cap treatment as the agent path before a wider release?
2. Does hosting a non-custodial swap front-end (human or agent) trigger money-transmission or VASP
   registration anywhere we serve?
3. Does linking to and aggregating third-party launchpads make us a facilitator of token issuance in any of our users' jurisdictions?
4. Which jurisdictions must be geo-blocked, and on which surfaces (swap, agent trading, or all)?
5. Are our disclosures sufficient in wording and placement, and do we need accepted terms before first use?
6. Do we need to retain trade records, and for how long? (Real trades are already logged —
   `real_ledger` in D1 — as an audit trail, not for compliance purposes specifically.)
7. The platform fee (`lib/feeSplit.ts`: 40% buyback / 30% insurance / 15% treasury / 10% builders /
   5% Solana ecosystem) is built and tested but not yet active (no treasury address set). Any structuring
   questions about the fee or the eventual $NMBR bond/slashing mechanism (`lib/bond.ts`, also built,
   not yet wired — no token exists) belong here before either goes live.

## Before a public launch
- [ ] Counsel review of this file and the in-app copy
- [ ] Terms of service and privacy policy published and linked
- [ ] Geo-blocking decision implemented
- [ ] **Decide whether human SwapPanel trading needs an allowlist/caps before wider release**
- [ ] Decide whether the agent allowlist stays as manual approval or gets a self-serve flow
