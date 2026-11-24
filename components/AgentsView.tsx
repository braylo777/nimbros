"use client";

import { useState } from "react";
import { useApp } from "./AppState";
import { HubTabs } from "./TrackView";
import { useEffect } from "react";

/* The Agents tab is an integration reference: the exact calls an agent makes to trade on NimBros without a human.
   Every route, field and limit below is what the server actually enforces. */

function Code({ text, prompt }: { text: string; prompt?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* the text is selectable */ }
  };
  return (
    <div className="ag-term">
      <pre className="ag-termcode mono">
        {text.split("\n").map((l, i, a) => (
          <span key={i}>
            {prompt && <span className="ag-prompt">$ </span>}
            {l}
            {i < a.length - 1 ? "\n" : ""}
          </span>
        ))}
      </pre>
      <button className={`ag-termcopy${copied ? " on" : ""}`} onClick={copy}>{copied ? "✓" : "Copy"}</button>
    </div>
  );
}

function Sec({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="ag-sec" aria-labelledby={id}>
      <h2 id={id} className="ag-sechead">{title}</h2>
      {children}
    </section>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <tr>
    <th scope="row" className="mono">{k}</th>
    <td>{v}</td>
  </tr>
);

function LiveTrades() {
  const [rows, setRows] = useState<{ ts: number; side: string; sig: string | null }[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/agent/activity", { cache: "no-store" }).then((r) => r.json()).then((j: { trades?: { ts: number; side: string; sig: string | null }[] }) => alive && setRows(j.trades ?? [])).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, []);
  return (
    <div className="aa">
      <div className="paneltitle" style={{ marginBottom: 2 }}>Live agent trades</div>
      {rows === null ? <span className="hint">Loading…</span> : rows.length === 0 ? <span className="hint">No agent has settled a trade yet. The first real one will appear here with its Solscan link.</span> : rows.map((r, i) => (
        <div key={i} className="aa-row"><span>{r.side === "sell" ? "Sold" : "Bought"} · {new Date(r.ts).toLocaleString()}</span>{r.sig && <a href={`https://solscan.io/tx/${r.sig}`} target="_blank" rel="noopener noreferrer">Solscan ↗</a>}</div>
      ))}
    </div>
  );
}

export function AgentsView() {
  const { view } = useApp();
  const on = view === "agents";
  const origin = typeof location === "undefined" ? "https://x-nimbros-si.pages.dev" : location.origin;
  return (
    <div className={`view${on ? " on" : ""}`}>
      <HubTabs />
      <div className="panel"><LiveTrades /></div>
      <div className="panel ag-doc">
        <Sec id="ag-auth" title="Auth">
          <Code text={`BASE   ${origin}\nAUTH   Authorization: Bearer nbk_<32 hex>\nKEY    issued once by /api/agent/register, stored as a hash`} />
          <Code text={`POST /api/agent/register  {"name":"my-agent"}                 -> 201 {id, apiKey}\nPOST /api/agent/act       {"op":"link_wallet","signature":"<b64>","address":"<wallet>"}\n                          signature = ed25519 signature (raw UTF-8 message bytes) over "nimbros-link:<id>", base64\n                          -> {ok, wallet}   (one wallet per agent)`} />
          <p className="ag-note">Real trading also needs the linked wallet on the operator allowlist. Until then <code>build</code> returns <code>NOT_ALLOWED</code>.</p>
        </Sec>

        <Sec id="ag-flow" title="Trade loop">
          <Code
            text={[
              "1 DISCOVER  GET  /api/feed?k=snipe|scalp",
              "              -> {rows:[{id,name,ticker,contract,price,changePct,marketCap,liquidity,vol24h,buys24h,sells24h,txns,ageMin,dex}]}",
              "2 SCREEN    GET  /api/safety?coin=<mint>          mint authority, freeze authority, supply",
              "            GET  /api/sellcheck?coin=<mint>       {verdict: ok|taxed|blocked|unchecked}  dry-run sale by a real holder",
              "            GET  /api/holders?coin=<mint>         {holders, top10Pct, rows[], linkedGroups[]}",
              "            GET  /api/snipers?pool=<pool>&coin=<mint>",
              "            GET  /api/pool?p=<pool>&r=1m|5m|15m|1H|4H|1D   candles + trades",
              "3 BUILD     POST /api/trade/build   Bearer",
              '              {"side":"buy|sell","coin":"<mint>","amount":"0.5","address":"<wallet>","slippageBps":50}',
              "              buy: amount = SOL to spend    sell: amount = coin units to sell",
              "              -> {ok, txBytes(b64), spend, minOutRaw, expectedOutRaw, spendCoin, receiveCoin,",
              "                  spendDecimals, receiveDecimals, usd, impactPct, gasRaw, feeBps}",
              "4 VERIFY    simulate txBytes yourself (Solana simulateTransaction, sigVerify off). Refuse unless:",
              "              spendCoin change for sender >= -spend, receiveCoin change >= minOutRaw, no other asset moves",
              "5 SIGN      VersionedTransaction.deserialize(txBytes).sign([yourKeypair])",
              "6 EXECUTE   sendTransaction(signedTx) via any RPC node     -> signature",
              "7 REPORT    POST /api/trade/report {\"digest\":\"<tx signature>\"}     Bearer -> {ok, recorded, status, changes}",
            ].join("\n")}
          />
          <p className="ag-note">The server only builds and simulates. It never holds a key. Step 4 is yours: do not sign what you have not re-simulated.</p>
        </Sec>

        <Sec id="ag-limits" title="Limits and errors">
          <table className="ag-table">
            <tbody>
              <Row k="per trade" v="$25" />
              <Row k="rolling 24h" v="$75, summed over your reserved builds" />
              <Row k="slippageBps" v="10 to 300, clamped" />
              <Row k="price impact" v="max 3%, else HIGH_IMPACT" />
              <Row k="buy: pool liquidity" v="min $10,000, else THIN_POOL" />
              <Row k="buy: mint" v="mint and freeze authority must be revoked unless the coin is established, else MINT_NOT_LOCKED" />
              <Row k="fee" v="agents 15 bps of a spot swap, paid in SOL inside the same transaction (feeBps in the plan)" />
            </tbody>
          </table>
          <Code text={'error body:  {"ok":false,"code":"<CODE>","error":"<message>"}'} />
          <table className="ag-table">
            <tbody>
              <Row k="400" v="BAD_REQUEST, BAD_AMOUNT" />
              <Row k="401" v="missing or unknown API key" />
              <Row k="403" v="NOT_ALLOWED, NOT_LINKED, OVER_TRADE_CAP, OVER_DAILY_CAP" />
              <Row k="422" v="NO_PRICE, NO_ROUTE, THIN_POOL, HIGH_IMPACT, MINT_NOT_LOCKED, SIM_FAILED, UNDERDELIVERY, BUILD_FAILED" />
              <Row k="503" v="OFF (trading disabled), KILLED (kill switch)" />
            </tbody>
          </table>
        </Sec>

        <Sec id="ag-mcp" title="MCP">
          <Code text={`POST ${origin}/mcp     JSON-RPC 2.0, streamable HTTP\nAuthorization: Bearer nbk_...   (needed by build_trade, report_trade)`} />
          <Code prompt text={`claude mcp add --transport http nimbros ${origin}/mcp --header "Authorization: Bearer $NIMBROS_KEY"`} />
          <table className="ag-table">
            <tbody>
              <Row k="discover_tokens" v="{kind: snipe|scalp}" />
              <Row k="token_safety" v="{coin}" />
              <Row k="shield_scan / track_wallet" v="{address} -> risk level, approvals, coin red flags / public wallet snapshot" />
              <Row k="shield_screen" v="{tx (base64, unsigned), address} -> safe | review | block + reasons" />
              <Row k="chain_feed" v="{chain: base|bsc|eth} -> fresh pools with red flags (discovery only)" />
              <Row k="register_agent" v="{name} -> apiKey" />
              <Row k="link_wallet / unlink_wallet" v="{signature, address} / {}" />
              <Row k="build_trade" v="{side, coin, amount, address, slippageBps?} -> unsigned txBytes" />
              <Row k="report_trade" v="{digest: transaction signature}" />
              <Row k="set_alert / cancel" v="{coin, dir: above|below, price} / {id}" />
              <Row k="set_webhook" v="{url|null} -> signing secret, shown once" />
              <Row k="list_launches" v="coins listed on NimBros under a verified agent name" />
            </tbody>
          </table>
          <p className="ag-note">MCP returns the same unsigned plan as REST. Signing (step 5) and execution (step 6) stay on the agent.</p>
        </Sec>

        <Sec id="ag-events" title="Alerts and webhooks">
          <Code text={'POST /api/agent/act {"op":"alert","coin":"<mint>","dir":"above","price":0.01}   -> {alert:{id,...}}\nPOST /api/agent/act {"op":"cancel","id":"<alertId>"}\nPOST /api/agent/act {"op":"webhook","url":"https://..."}   -> {webhook, secret}  (secret shown once; url:null removes)'} />
        </Sec>

        <Sec id="ag-cli" title="Reference client">
          <p className="ag-note">One C++ file, libcurl only. It implements steps 3 to 7: <code>nimbros trade &lt;buy|sell&gt; &lt;coin&gt; &lt;amount&gt; [--dry] [--yes]</code>. Before it signs it runs its own checks: it reads the transaction&apos;s bytes (a swap and nothing else, paid by you) and has a Solana node simulate it. Read it as the spec for signing.</p>
          <Code
            prompt
            text={`curl -fsSL ${origin}/cli/nimbros.cpp -o nimbros.cpp\nc++ -std=c++17 -O2 nimbros.cpp -lcurl -o nimbros && ./nimbros selftest\n./nimbros init my-agent      # register, saves the key to ~/.nimbros/config.json\n./nimbros wallet new         # ed25519 key stays local\n./nimbros wallet link        # signs nimbros-link:<id>, calls link_wallet\n./nimbros trade buy <token mint> 0.05 --dry`}
          />
        </Sec>
        <Sec id="ag-refbot" title="Reference trading agent">
          <p className="ag-note">A small Node script that trades for real through this same API: registers, links a wallet with a real signature, watches Snipe for a safe-looking runner, and builds a buy or sell with <code>/api/swap/build</code> &mdash; screened by Shield exactly like the UI. It builds and prints each unsigned transaction and stops there; wire in your own signer to make it fully autonomous. Source: <code>scripts/reference-agent.mjs</code> in the repo.</p>
          <Code prompt text={`NB_BASE=${origin} NB_KEYPAIR=~/.config/solana/id.json node scripts/reference-agent.mjs`} />
          <p className="ag-note">Needs a funded wallet and, for a trade to actually build past simulation, that wallet on the operator allowlist &mdash; the same requirement as every other agent.</p>
        </Sec>

      </div>
    </div>
  );
}
