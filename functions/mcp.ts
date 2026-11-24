import { act, authenticate, register } from "../lib/agentApi.ts";
import { depsFrom, json, type Env } from "../lib/agentHttp.ts";

/* NimBros MCP server (streamable HTTP, JSON responses). Point an MCP client at https://<site>/mcp.
   Discovery, safety, Shield and tracking tools are read-only. Everything else acts on a registered agent's
   account (send its key as `Authorization: Bearer <key>`) or moves real money — nothing here is
   simulated. build_trade only ever returns unsigned, already-simulated bytes; the agent signs and
   submits them itself. */

const str = (d: string) => ({ type: "string", description: d });
const TOOLS = [
  { name: "discover_tokens", description: "Live Solana memecoin lists from pump.fun, bonk.fun, Moonshot, Meteora, Raydium and more. kind=snipe: newest liquid pools. kind=scalp: graduated, trending pools.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["snipe", "scalp"] } }, required: ["kind"] } },
  { name: "token_safety", description: "On-chain checks for a coin: mint authority, freeze authority, supply.", inputSchema: { type: "object", properties: { coin: str("token mint address (base58)") }, required: ["coin"] } },
  { name: "shield_scan", description: "Read-only security report for a Solana wallet: risk level and score, open token approvals (who can spend your tokens), per-coin red flags (live mint/freeze keys, concentrated ownership, serial deployers), recent activity.", inputSchema: { type: "object", properties: { address: str("Solana wallet address") }, required: ["address"] } },
  { name: "shield_screen", description: "Screen an UNSIGNED base64 Solana transaction before signing: unknown programs, token approvals, authority changes, accounts closed into someone else's wallet, SOL leaving, scam-watchlist wallets. Verdict safe | review | block.", inputSchema: { type: "object", properties: { tx: str("base64 unsigned transaction"), address: str("the signing wallet") }, required: ["tx", "address"] } },
  { name: "track_wallet", description: "Public snapshot of any wallet: SOL, holdings, latest moves, and whether it is on the scam watchlist.", inputSchema: { type: "object", properties: { address: str("Solana wallet address") }, required: ["address"] } },
  { name: "chain_feed", description: "Fresh pools on another chain (base, bsc, eth) with red-flag hints. Discovery only: swaps are Solana-only.", inputSchema: { type: "object", properties: { chain: { type: "string", enum: ["base", "bsc", "eth"] } }, required: ["chain"] } },
  { name: "shield_watch", description: "Have NimBros watch a wallet in the background (up to 5) and send a signed `shield_alert` to your webhook when a new approval or coin danger appears. Needs a webhook (set_webhook). on:false stops.", inputSchema: { type: "object", properties: { address: str("Solana wallet address"), on: { type: "boolean" } }, required: ["address"] } },
  { name: "list_launches", description: "Coins launched through NimBros, newest first.", inputSchema: { type: "object", properties: {} } },
  { name: "register_agent", description: "Create an agent identity. Returns an API key once; keep it. Trading real money also needs link_wallet.", inputSchema: { type: "object", properties: { name: str("2-24 chars") }, required: ["name"] } },
  { name: "set_alert", description: "Server-side price alert; delivered to your webhook.", inputSchema: { type: "object", properties: { coin: str("token mint address"), dir: { type: "string", enum: ["above", "below"] }, price: { type: "number" } }, required: ["coin", "dir", "price"] } },
  { name: "cancel", description: "Cancel an open alert by id.", inputSchema: { type: "object", properties: { id: str("alert id") }, required: ["id"] } },
  { name: "set_webhook", description: "Get signed JSON events (alerts) at your public https URL. Pass url:null to remove. The signing secret is returned once.", inputSchema: { type: "object", properties: { url: { type: ["string", "null"] } }, required: ["url"] } },
  { name: "link_wallet", description: "Prove your agent controls a Solana wallet: sign the message `nimbros-link:<your agent id>` (ed25519, raw UTF-8 bytes) and send the base64 signature plus your address. Required before any real trade.", inputSchema: { type: "object", properties: { signature: str("base64 ed25519 signature"), address: str("the Solana wallet address that made the signature") }, required: ["signature", "address"] } },
  { name: "unlink_wallet", description: "Remove the linked wallet from your agent.", inputSchema: { type: "object", properties: {} } },
  { name: "build_trade", description: "REAL swap against SOL via Jupiter, returned UNSIGNED and already simulated (txBytes = a base64 Solana VersionedTransaction: deserialize, sign with your ed25519 key, submit with sendTransaction). Needs an approved, linked wallet; capped per trade and per 24h. buy: amount = SOL to spend. sell: amount = coins to sell. The nimbros CLI does all of this for you: `nimbros trade`.", inputSchema: { type: "object", properties: { side: { type: "string", enum: ["buy", "sell"] }, coin: str("token mint address"), amount: str("plain decimal, e.g. 0.5"), address: str("your linked address"), slippageBps: { type: "number" } }, required: ["side", "coin", "amount", "address"] } },
  { name: "report_trade", description: "After you execute a built trade, send its digest so NimBros records the on-chain result.", inputSchema: { type: "object", properties: { digest: str("transaction signature") }, required: ["digest"] } },
];

interface Rpc { jsonrpc?: string; id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }
const reply = (id: unknown, result: unknown) => json({ jsonrpc: "2.0", id, result });
const rpcErr = (id: unknown, code: number, message: string) => json({ jsonrpc: "2.0", id, error: { code, message } });
const text = (v: unknown, isError = false) => ({ content: [{ type: "text", text: JSON.stringify(v) }], isError });

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  let m: Rpc;
  try { m = (await request.json()) as Rpc; } catch { return rpcErr(null, -32700, "parse error"); }
  if (m.id === undefined) return new Response(null, { status: 202 }); // notification
  if (m.method === "initialize") return reply(m.id, { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "nimbros", version: "0.1.0" } });
  if (m.method === "ping") return reply(m.id, {});
  if (m.method === "tools/list") return reply(m.id, { tools: TOOLS });
  if (m.method !== "tools/call") return rpcErr(m.id, -32601, "method not found");

  const name = m.params?.name ?? "";
  const a = m.params?.arguments ?? {};
  const origin = new URL(request.url).origin;
  const get = async (path: string) => { const r = await fetch(origin + path); return r.ok ? await r.json() : { error: `upstream ${r.status}` }; };
  try {
    switch (name) {
      case "discover_tokens": return reply(m.id, text(await get(`/api/feed?k=${a.kind === "scalp" ? "scalp" : "snipe"}`)));
      case "token_safety": return reply(m.id, text(await get(`/api/safety?coin=${encodeURIComponent(String(a.coin ?? ""))}`)));
      case "shield_scan": return reply(m.id, text(await get(`/api/shield/scan?address=${encodeURIComponent(String(a.address ?? ""))}`)));
      case "track_wallet": return reply(m.id, text(await get(`/api/track?address=${encodeURIComponent(String(a.address ?? ""))}`)));
      case "chain_feed": return reply(m.id, text(await get(`/api/chainfeed?chain=${encodeURIComponent(String(a.chain ?? ""))}`)));
      case "shield_screen": { const r = await fetch(origin + "/api/shield/screen", { method: "POST", body: JSON.stringify({ tx: a.tx, address: a.address }) }); return reply(m.id, text(await r.json(), !r.ok)); }
      case "shield_watch": { const r = await fetch(origin + "/api/shield/watch", { method: "POST", headers: { authorization: request.headers.get("authorization") ?? "" }, body: JSON.stringify({ address: a.address, on: a.on }) }); return reply(m.id, text(await r.json(), !r.ok)); }
      case "list_launches": return reply(m.id, text(await get("/api/launches")));
      case "build_trade": case "report_trade": {
        const path = name === "build_trade" ? "/api/trade/build" : "/api/trade/report";
        const r = await fetch(origin + path, { method: "POST", headers: { authorization: request.headers.get("authorization") ?? "" }, body: JSON.stringify(a) });
        return reply(m.id, text(await r.json(), !r.ok));
      }
      default: break;
    }
    const d = depsFrom(env);
    if (!d) return reply(m.id, text({ error: "unavailable" }, true));
    if (name === "register_agent") { const r = await register(d, a.name); return reply(m.id, text(r, !r.ok)); }
    const OPS: Record<string, string> = { link_wallet: "link_wallet", unlink_wallet: "unlink_wallet", cancel: "cancel", set_alert: "alert", set_webhook: "webhook" };
    if (Object.hasOwn(OPS, name)) {
      const acct = await authenticate(d, request.headers.get("authorization"));
      if ("ok" in acct) return reply(m.id, text({ error: acct.error }, true));
      const r = await act(d, acct, { ...a, op: OPS[name] });
      return reply(m.id, text(r, !r.ok));
    }
    return rpcErr(m.id, -32602, `unknown tool ${name}`);
  } catch {
    return reply(m.id, text({ error: "tool failed" }, true));
  }
}
export const onRequestGet = () => new Response("NimBros MCP: POST JSON-RPC here.", { status: 405, headers: { allow: "POST" } });
