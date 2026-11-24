/* Everything an agent (or its developer) needs. Shown in the Agents tab and on /agents.
   No hooks and no browser APIs, so it renders anywhere. */

const box = { background: "var(--surface-2, #f4f1ea)", padding: 12, borderRadius: 8, overflowX: "auto" as const, fontSize: 13 };

export function AgentGuide({ origin }: { origin: string }) {
  return (
    <div style={{ lineHeight: 1.55 }}>
      <h2>Connect</h2>
      <p>Point any MCP client at the endpoint below. It can discover coins across every Solana launchpad, check safety, and trade real money.</p>
      <pre style={box}>{`MCP endpoint   ${origin}/mcp
Tools          discover_tokens, token_safety, shield_scan, shield_screen, track_wallet, chain_feed,
               list_launches, register_agent, cancel,
               set_alert, set_webhook, link_wallet, unlink_wallet, build_trade, report_trade`}</pre>
      <p>Prefer plain HTTP? Register once, then send your key as <code>Authorization: Bearer nbk_…</code>. The key is shown once.</p>
      <pre style={box}>{`POST ${origin}/api/agent/register   {"name":"my-agent"}
POST ${origin}/api/trade/build      {"side":"buy","coin":"<token mint>","amount":"0.5","address":"<your wallet>"}
POST ${origin}/api/agent/act        {"op":"alert", …}   (alerts, webhooks, wallet link)`}</pre>

      <h2>Alerts and webhooks</h2>
      <p>Server-side price alerts, delivered to your own https endpoint. A scheduler checks them every 15 seconds, so they fire while your agent is offline.</p>
      <pre style={box}>{`{"op":"alert","coin":"<token mint>","dir":"above","price":2}
{"op":"webhook","url":"https://your.host/hook"}                                         signed events; secret shown once
{"op":"cancel","id":"…"}`}</pre>
      <ul>
        <li>Webhooks carry <code>x-nimbros-signature: sha256=…</code>, an HMAC of the exact body. Failed deliveries retry up to 5 times.</li>
      </ul>

      <h2>Real trading</h2>
      <p>Real swaps use your own wallet and your own money, routed by Jupiter across every Solana venue (pump.fun, PumpSwap, Raydium, Meteora, Orca, Moonshot and more). NimBros builds and checks the transaction; your key signs it on your machine. Every wallet must be approved by NimBros first, and every request is checked again.</p>
      <ul>
        <li><b>Buy</b> spends that much SOL. <b>Sell</b> sells that many coins (plain decimal, in the coin&apos;s own units).</li>
        <li>Before you sign, simulate the exact transaction yourself and refuse unless only the two assets move, no more than the chosen amount leaves, and at least the minimum arrives. NimBros already does this, but don&apos;t just take its word for it.</li>
        <li>The wallet must be approved by NimBros and linked to your agent. Default caps are $25 per trade and $75 per 24 hours.</li>
        <li>NimBros also refuses pools under $10K, price impact over 3%, and new coins whose mint or freeze authority isn&apos;t revoked. Slippage is 0.1% to 3% (default 1%). Every build counts against your 24-hour cap.</li>
        <li><code>POST /api/trade/build</code> returns <code>txBytes</code>: a base64 Solana <code>VersionedTransaction</code>. Deserialize it, sign it with your ed25519 key, submit it with <code>sendTransaction</code> through any RPC node, and record it with <code>POST /api/trade/report</code> using the transaction signature.</li>
        <li>NimBros can pause all real trading at any time.</li>
      </ul>

      <h2>Launchpads</h2>
      <p>NimBros reads new coins and graduations from pump.fun, bonk.fun, Moonshot, Meteora, Raydium LaunchLab and more, so <code>discover_tokens</code> covers all of them in one list. NimBros never launches a coin for anyone: you launch on the launchpad itself, with your own wallet.</p>
      <ul>
        <li>To list a coin under a verified agent name, sign the message <code>nimbros-list:&lt;mint&gt;:&lt;agent&gt;</code> with the wallet that controls the coin&apos;s mint authority, and send it to <code>POST /api/launches</code> with the mint, the agent name and your address.</li>
        <li><code>GET /api/launches</code> returns the newest first and refreshes every second.</li>
      </ul>

      <h2>Give your agent a wallet</h2>
      <ul>
        <li>Generate an ed25519 keypair with the Solana CLI or SDK, keep it in your own secrets store, and link it with the <code>link_wallet</code> tool: sign the message <code>nimbros-link:&lt;your agent id&gt;</code> (raw UTF-8 bytes) and send the base64 signature with your wallet address. Only a signature is sent.</li>
        <li>Never paste a private key or recovery phrase into a website.</li>
      </ul>

      <h2>What Solana gives an agent</h2>
      <ul>
        <li>Roughly 400 ms slots, so a signed swap lands in about a second.</li>
        <li>One transaction can wrap, swap, pay a fee and unwrap atomically: it all happens or none of it does.</li>
        <li>Fees are fractions of a cent. Swapping still needs a little SOL for network fees and any new token account.</li>
      </ul>

      <h2>Rules</h2>
      <p>Agents and people follow the same rules. Nothing here is investment advice, and a listing is not an endorsement. Launching coins that imitate others, or that are built to be sold into buyers, may be illegal where you are.</p>
    </div>
  );
}
