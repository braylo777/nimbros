import test from "node:test";
import assert from "node:assert/strict";
import { newD1, post, req } from "./d1shim.ts";
import { onRequestPost as mcp, onRequestGet as mcpGet } from "../functions/mcp.ts";
import { onRequestPost as regPost } from "../functions/api/agent/register.ts";
import { onRequestPost as actPost } from "../functions/api/agent/act.ts";
import { onRequestGet as activityGet } from "../functions/api/agent/activity.ts";
import { onRequestGet as statsGet } from "../functions/api/stats.ts";
import { onRequestGet as launchesGet } from "../functions/api/launches.ts";

/* Contract tests: the public REST + MCP surface that agents depend on.
   Handlers run against a real SQLite database loaded from db/schema.sql. */

type Env = { DB?: unknown; FEEDS?: unknown; CRON_SECRET?: string };
const fresh = (): Env => ({ DB: newD1() });
const rpc = async (env: Env, body: unknown, headers: Record<string, string> = {}) => {
  const r = await mcp({ request: post("/mcp", body, headers), env: env as never });
  return { status: r.status, json: r.status === 202 ? null : ((await r.json()) as Record<string, any>) };
};
const call = async (env: Env, name: string, args: Record<string, unknown> = {}, key?: string) => {
  const r = await rpc(env, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, key ? { authorization: `Bearer ${key}` } : {});
  const res = r.json?.result;
  return { rpc: r.json, isError: res?.isError as boolean | undefined, data: res ? JSON.parse(res.content[0].text) : null };
};
const restReg = (env: Env, name: unknown, ip = "1.1.1.1") =>
  regPost({ request: post("/api/agent/register", { name }, { "cf-connecting-ip": ip }), env: env as never });
const restAct = (env: Env, body: unknown, key?: string) =>
  actPost({ request: post("/api/agent/act", body, key ? { authorization: `Bearer ${key}` } : {}), env: env as never });

/* ---------- MCP protocol ---------- */
test("MCP initialize returns protocol version, tools capability and server info", async () => {
  const r = await rpc(fresh(), { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json!.jsonrpc, "2.0");
  assert.equal(r.json!.id, 1);
  assert.equal(r.json!.result.protocolVersion, "2025-03-26");
  assert.deepEqual(r.json!.result.capabilities, { tools: {} });
  assert.equal(r.json!.result.serverInfo.name, "nimbros");
});
test("MCP ping answers with an empty result and echoes the id", async () => {
  const r = await rpc(fresh(), { jsonrpc: "2.0", id: "abc", method: "ping" });
  assert.deepEqual(r.json, { jsonrpc: "2.0", id: "abc", result: {} });
});
test("MCP notification (no id) gets 202 and no body", async () => {
  const r = await rpc(fresh(), { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(r.status, 202);
});
test("MCP malformed JSON gives parse error -32700 with null id", async () => {
  const r = await mcp({ request: post("/mcp", "{not json"), env: fresh() as never });
  const j = (await r.json()) as any;
  assert.equal(j.error.code, -32700);
  assert.equal(j.id, null);
});
test("MCP unknown method gives -32601", async () => {
  const r = await rpc(fresh(), { jsonrpc: "2.0", id: 2, method: "resources/list" });
  assert.equal(r.json!.error.code, -32601);
});
test("MCP GET is 405 with allow: POST", async () => {
  const r = mcpGet();
  assert.equal(r.status, 405);
  assert.equal(r.headers.get("allow"), "POST");
});
for (const id of [0, 1, "x", "9f86d081", 123456789, null]) {
  test(`MCP echoes request id ${JSON.stringify(id)}`, async () => {
    const r = await rpc(fresh(), { jsonrpc: "2.0", id, method: "ping" });
    assert.equal(r.json!.id, id);
  });
}
for (const m of ["", "tools", "tools/get", "prompts/list", "completion/complete", "tools/call/", "TOOLS/LIST", "logging/setLevel"]) {
  test(`MCP rejects unsupported method ${JSON.stringify(m)}`, async () => {
    const r = await rpc(fresh(), { jsonrpc: "2.0", id: 3, method: m });
    assert.equal(r.json!.error.code, -32601);
  });
}

/* ---------- tool catalogue ---------- */
const EXPECTED_TOOLS = ["discover_tokens", "token_safety", "shield_scan", "shield_screen", "track_wallet", "chain_feed", "shield_watch", "list_launches", "register_agent", "set_alert", "cancel", "set_webhook", "link_wallet", "unlink_wallet", "build_trade", "report_trade"];
const catalogue = (await rpc(fresh(), { jsonrpc: "2.0", id: 1, method: "tools/list" })).json!.result.tools as Array<{ name: string; description: string; inputSchema: { type: string; properties: Record<string, any>; required?: string[] } }>;
test("tools/list returns exactly the documented tools in order", () => {
  assert.deepEqual(catalogue.map((t) => t.name), EXPECTED_TOOLS);
});
test("tool names are unique", () => assert.equal(new Set(catalogue.map((t) => t.name)).size, catalogue.length));
for (const t of catalogue) {
  test(`tool ${t.name}: snake_case name`, () => assert.match(t.name, /^[a-z]+(_[a-z]+)*$/));
  test(`tool ${t.name}: description is a real sentence`, () => { assert.ok(t.description.length >= 20); assert.match(t.description, /[.:!)]$|[a-z]$/); });
  test(`tool ${t.name}: inputSchema is an object schema`, () => { assert.equal(t.inputSchema.type, "object"); assert.equal(typeof t.inputSchema.properties, "object"); });
  test(`tool ${t.name}: every required field is declared`, () => { for (const k of t.inputSchema.required ?? []) assert.ok(k in t.inputSchema.properties, `${k} missing`); });
  test(`tool ${t.name}: every property declares a type`, () => { for (const [k, v] of Object.entries(t.inputSchema.properties)) assert.ok(v.type !== undefined, `${k} has no type`); });
  test(`tool ${t.name}: enum values are non-empty strings`, () => { for (const v of Object.values(t.inputSchema.properties)) if (v.enum) { assert.ok(v.enum.length > 0); for (const e of v.enum) assert.equal(typeof e, "string"); } });
  test(`tool ${t.name}: description never promises simulated money`, () => assert.ok(!/paper|virtual|simulated funds/i.test(t.description)));
}
test("only build_trade and report_trade are described as moving real money", () => {
  const real = catalogue.filter((t) => /REAL|real money/.test(t.description)).map((t) => t.name);
  assert.ok(real.includes("build_trade"));
  assert.ok(!real.includes("discover_tokens"));
});
test("build_trade requires side, coin, amount and address", () => {
  const t = catalogue.find((x) => x.name === "build_trade")!;
  assert.deepEqual([...t.inputSchema.required!].sort(), ["address", "amount", "coin", "side"]);
  assert.deepEqual(t.inputSchema.properties.side.enum, ["buy", "sell"]);
});

/* ---------- tool calls without a database ---------- */
for (const name of ["register_agent", "set_alert", "cancel", "set_webhook", "link_wallet", "unlink_wallet"]) {
  test(`MCP ${name} without a database reports unavailable as a tool error`, async () => {
    const r = await call({}, name, { name: "bot-x" });
    assert.equal(r.isError, true);
    assert.equal(r.data.error, "unavailable");
  });
}
for (const name of ["", "nope", "REGISTER_AGENT", "drop_table", "register-agent", "set_alert ", "__proto__", "constructor"]) {
  test(`MCP unknown tool ${JSON.stringify(name)} gives -32602`, async () => {
    const r = await call(fresh(), name, {});
    assert.equal(r.rpc!.error.code, -32602);
  });
}
test("MCP tools/call with no params does not crash", async () => {
  const r = await rpc(fresh(), { jsonrpc: "2.0", id: 4, method: "tools/call" });
  assert.equal(r.status, 200);
  assert.ok(r.json!.error);
});

/* ---------- registration over REST and MCP ---------- */
const GOOD = ["bot-1", "My Agent", "a1", "Zz", "agent_007", "x.y", "A-B-C", "alpha beta", "0day", "trader.v2", "sniper_bot_24", "Nim Bot 9", "ab", "9a", "q.r", "Q_R", "a b", "a-b", "a.b", "a_b", "abcdefghijklmnopqrstuvwx"];
const BAD: unknown[] = ["", "a", " ", "-bot", "_bot", ".bot", "bot!", "bo@t", "abcdefghijklmnopqrstuvwxy", "bot/1", "bot\n1", "<script>", "bot'; DROP", "名前", "a😀", 12, null, undefined, {}, [], true, "  ", "a".repeat(200)];
GOOD.forEach((n, i) => {
  test(`REST register accepts good name ${JSON.stringify(n)}`, async () => {
    const r = await restReg(fresh(), n, `10.0.0.${i}`);
    assert.equal(r.status, 201);
    const j = (await r.json()) as any;
    assert.match(j.apiKey, /^nbk_[0-9a-f]{32}$/);
    assert.equal(j.ok, true);
    assert.ok(j.id);
  });
  test(`MCP register_agent accepts good name ${JSON.stringify(n)}`, async () => {
    const r = await call(fresh(), "register_agent", { name: n });
    assert.equal(r.isError, false);
    assert.match(r.data.apiKey, /^nbk_[0-9a-f]{32}$/);
  });
});
BAD.forEach((n, i) => {
  test(`REST register rejects bad name #${i} ${JSON.stringify(n)?.slice(0, 20)}`, async () => {
    const r = await restReg(fresh(), n, `10.1.0.${i}`);
    assert.equal(r.status, 400);
    assert.ok(((await r.json()) as any).error);
  });
  test(`MCP register_agent rejects bad name #${i} ${JSON.stringify(n)?.slice(0, 20)}`, async () => {
    const r = await call(fresh(), "register_agent", { name: n });
    assert.equal(r.isError, true);
    assert.equal(r.data.status, 400);
  });
});
test("REST register rejects a body that is not JSON", async () => {
  const r = await regPost({ request: post("/api/agent/register", "nope"), env: fresh() as never });
  assert.equal(r.status, 400);
});
test("REST register without a database is 503", async () => {
  const r = await regPost({ request: post("/api/agent/register", { name: "bot-1" }), env: {} as never });
  assert.equal(r.status, 503);
});
test("REST register: duplicate name (case-insensitive) is 409", async () => {
  const env = fresh();
  assert.equal((await restReg(env, "Dupe", "2.2.2.1")).status, 201);
  assert.equal((await restReg(env, "dupe", "2.2.2.2")).status, 409);
  assert.equal((await restReg(env, "DUPE", "2.2.2.3")).status, 409);
});
test("REST register: sixth registration from one address in an hour is 429", async () => {
  const env = fresh();
  for (let i = 0; i < 5; i++) assert.equal((await restReg(env, `rl-bot-${i}`, "3.3.3.3")).status, 201);
  assert.equal((await restReg(env, "rl-bot-5", "3.3.3.3")).status, 429);
  assert.equal((await restReg(env, "rl-bot-6", "4.4.4.4")).status, 201);
});
test("registration response never contains a stored hash or secret fields", async () => {
  const j = (await (await restReg(fresh(), "leakcheck", "5.5.5.5")).json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(j).sort(), ["apiKey", "id", "ok"]);
});
test("two registrations get different keys and ids", async () => {
  const env = fresh();
  const a = (await (await restReg(env, "twin-a", "6.6.6.1")).json()) as any;
  const b = (await (await restReg(env, "twin-b", "6.6.6.2")).json()) as any;
  assert.notEqual(a.apiKey, b.apiKey);
  assert.notEqual(a.id, b.id);
});

/* ---------- authentication on act ---------- */
const OPS: Array<[string, Record<string, unknown>]> = [
  ["alert", { coin: "FrogMint1111111111111111111111111111111111", dir: "above", price: 1 }],
  ["cancel", { id: "zzz" }],
  ["webhook", { url: "https://example.com/hook" }],
  ["link_wallet", { signature: "AAAA", address: "11111111111111111111111111111111" }],
  ["unlink_wallet", {}],
];
const AUTHS: Array<[string, string | undefined]> = [["no header", undefined], ["wrong key", "nbk_" + "0".repeat(32)], ["empty key", ""], ["junk key", "hello"]];
for (const [op, rest] of OPS) for (const [label, key] of AUTHS) {
  test(`REST act ${op} with ${label} is 401`, async () => {
    const r = await restAct(fresh(), { op, ...rest }, key);
    assert.equal(r.status, 401);
  });
}
for (const [op] of OPS) {
  test(`REST act ${op} without a database is 503`, async () => {
    const r = await actPost({ request: post("/api/agent/act", { op }), env: {} as never });
    assert.equal(r.status, 503);
  });
}
for (const t of ["set_alert", "cancel", "set_webhook", "link_wallet", "unlink_wallet"]) {
  test(`MCP ${t} without a key is a tool error, not a crash`, async () => {
    const r = await call(fresh(), t, {});
    assert.equal(r.isError, true);
    assert.ok(r.data.error);
  });
}

/* ---------- act with a valid agent ---------- */
async function agent(env: Env, name = "actor", ip = "7.7.7.7") {
  const j = (await (await restReg(env, name, ip)).json()) as { id: string; apiKey: string };
  return j;
}
const COIN = "FrogMint1111111111111111111111111111111111";
test("act with an unknown op is 400 and names the allowed ops", async () => {
  const env = fresh(); const a = await agent(env);
  const r = await restAct(env, { op: "withdraw_everything" }, a.apiKey);
  assert.equal(r.status, 400);
  assert.match(((await r.json()) as any).error, /cancel, alert, webhook, link_wallet, unlink_wallet/);
});
test("act with a missing op is 400", async () => {
  const env = fresh(); const a = await agent(env);
  assert.equal((await restAct(env, {}, a.apiKey)).status, 400);
});
test("act with a non-JSON body is 400", async () => {
  const env = fresh(); const a = await agent(env);
  const r = await actPost({ request: post("/api/agent/act", "{{", { authorization: `Bearer ${a.apiKey}` }), env: env as never });
  assert.equal(r.status, 400);
});
const ALERT_BAD: Array<[string, Record<string, unknown>]> = [
  ["no coin", { dir: "above", price: 1 }],
  ["empty coin", { coin: "", dir: "above", price: 1 }],
  ["numeric coin", { coin: 5, dir: "above", price: 1 }],
  ["no dir", { coin: COIN, price: 1 }],
  ["dir sideways", { coin: COIN, dir: "sideways", price: 1 }],
  ["dir uppercase", { coin: COIN, dir: "ABOVE", price: 1 }],
  ["no price", { coin: COIN, dir: "above" }],
  ["price zero", { coin: COIN, dir: "above", price: 0 }],
  ["price negative", { coin: COIN, dir: "above", price: -1 }],
  ["price string", { coin: COIN, dir: "above", price: "1" }],
  ["price NaN-like", { coin: COIN, dir: "above", price: null }],
  ["price object", { coin: COIN, dir: "above", price: {} }],
];
for (const [label, spec] of ALERT_BAD) {
  test(`REST alert rejects ${label} with 422`, async () => {
    const env = fresh(); const a = await agent(env);
    assert.equal((await restAct(env, { op: "alert", ...spec }, a.apiKey)).status, 422);
  });
  test(`MCP set_alert rejects ${label}`, async () => {
    const env = fresh(); const a = await agent(env);
    const r = await call(env, "set_alert", spec, a.apiKey);
    assert.equal(r.isError, true);
    assert.equal(r.data.status, 422);
  });
}
test("alert lifecycle over REST: create, then cancel by id, then cancel again is 404", async () => {
  const env = fresh(); const a = await agent(env);
  const c = await restAct(env, { op: "alert", coin: COIN, dir: "below", price: 0.5 }, a.apiKey);
  assert.equal(c.status, 200);
  const alert = ((await c.json()) as any).alert;
  assert.equal(alert.dir, "below");
  assert.equal(alert.price, 0.5);
  assert.equal((await restAct(env, { op: "cancel", id: alert.id }, a.apiKey)).status, 200);
  assert.equal((await restAct(env, { op: "cancel", id: alert.id }, a.apiKey)).status, 404);
});
test("alert lifecycle over MCP matches REST", async () => {
  const env = fresh(); const a = await agent(env);
  const c = await call(env, "set_alert", { coin: COIN, dir: "above", price: 2 }, a.apiKey);
  assert.equal(c.isError, false);
  const x = await call(env, "cancel", { id: c.data.alert.id }, a.apiKey);
  assert.equal(x.isError, false);
  assert.equal(x.data.cancelled, c.data.alert.id);
});
test("alerts are capped per agent", async () => {
  const env = fresh(); const a = await agent(env);
  let last = 200;
  for (let i = 0; i < 40 && last === 200; i++) last = (await restAct(env, { op: "alert", coin: COIN, dir: "above", price: i + 1 }, a.apiKey)).status;
  assert.equal(last, 422);
});
const HOOK_BAD = ["http://example.com/h", "https://localhost/h", "https://127.0.0.1/h", "https://10.0.0.5/h", "https://printer.local/h", "https://svc.internal/h", "https://user:pw@example.com/h", "https://example.com:8443/h", "ftp://example.com/h", "not a url", "https://intranet/h", "https://[::1]/h", "https://" + "a".repeat(300) + ".com", "javascript:alert(1)", "", 42];
HOOK_BAD.forEach((u, i) => {
  test(`webhook rejects unsafe url #${i} ${String(u).slice(0, 30)}`, async () => {
    const env = fresh(); const a = await agent(env);
    assert.equal((await restAct(env, { op: "webhook", url: u }, a.apiKey)).status, 422);
  });
});
test("webhook accepts https and returns the signing secret once", async () => {
  const env = fresh(); const a = await agent(env);
  const r = await restAct(env, { op: "webhook", url: "https://hooks.example.com/nimbros" }, a.apiKey);
  assert.equal(r.status, 200);
  const j = (await r.json()) as any;
  assert.match(j.secret, /^nbsec_[0-9a-f]{32}$/);
  assert.equal(j.webhook, "https://hooks.example.com/nimbros");
  const off = (await (await restAct(env, { op: "webhook", url: null }, a.apiKey)).json()) as any;
  assert.equal(off.webhook, null);
  assert.equal(off.secret, undefined);
});
test("link_wallet with a junk signature is 422 and a missing address is 400", async () => {
  const env = fresh(); const a = await agent(env);
  assert.equal((await restAct(env, { op: "link_wallet", signature: "AAAA", address: "9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj" }, a.apiKey)).status, 422);
  assert.equal((await restAct(env, { op: "link_wallet", signature: "AAAA" }, a.apiKey)).status, 400);
  assert.equal((await restAct(env, { op: "link_wallet", address: "9C6hybhQ6Aycep9jaUnP6uL9ZYvDjUp1aSkFWPUFJtpj" }, a.apiKey)).status, 400);
});
test("unlink_wallet on an agent with no wallet succeeds and reports null", async () => {
  const env = fresh(); const a = await agent(env);
  const j = (await (await restAct(env, { op: "unlink_wallet" }, a.apiKey)).json()) as any;
  assert.equal(j.wallet, null);
});

/* ---------- read-only endpoints ---------- */
test("GET /api/stats without a database returns zeroes", async () => {
  const r = await statsGet({ env: {} as never });
  assert.deepEqual(await r.json(), { activeAgents: 0, agentTxns: 0, vol24hUsd: 0 });
});
test("GET /api/stats with an empty ledger returns zeroes and is edge-cacheable", async () => {
  const r = await statsGet({ env: fresh() as never });
  assert.deepEqual(await r.json(), { activeAgents: 0, agentTxns: 0, vol24hUsd: 0 });
  assert.match(r.headers.get("cache-control")!, /s-maxage=30/);
});
test("GET /api/agent/activity without a database is an empty list", async () => {
  const r = await (activityGet as any)({ request: req("/api/agent/activity"), env: {} });
  assert.deepEqual(await r.json(), { trades: [] });
});
test("GET /api/launches without storage is an empty list", async () => {
  const r = await (launchesGet as any)({ env: {} });
  assert.equal(r.status, 200);
  const j = (await r.json()) as any;
  assert.ok(Array.isArray(j.launches ?? j));
});
for (const [name, fn] of [["stats", () => statsGet({ env: fresh() as never })], ["launches", () => (launchesGet as any)({ env: {} })]] as const) {
  test(`${name} replies with JSON content-type`, async () => {
    assert.match((await fn()).headers.get("content-type")!, /application\/json/);
  });
}
