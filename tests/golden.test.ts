import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { newD1 } from "./d1shim.ts";
import { AgentClient, normalise } from "./agentClient.ts";

/* Golden tests: the agent-visible transcript must not change by accident.
   After an intended change, run:  UPDATE_GOLDEN=1 node --test tests/golden.test.ts  and review the diff. */
const golden = (name: string, actual: unknown) => {
  const path = new URL(`./golden/${name}.json`, import.meta.url);
  const text = JSON.stringify(actual, null, 2) + "\n";
  if (process.env.UPDATE_GOLDEN || !existsSync(path)) writeFileSync(path, text);
  assert.equal(text, readFileSync(path, "utf8"), `golden ${name} changed`);
};
const COIN = "FrogMint1111111111111111111111111111111111";

test("golden: handshake and tool catalogue", async () => {
  const c = new AgentClient({ DB: newD1() });
  await c.rpc("initialize", "initialize", { protocolVersion: "2025-03-26" });
  await c.rpc("ping", "ping");
  await c.rpc("list", "tools/list");
  golden("handshake", normalise(c.log));
});

test("golden: onboarding flow (register, alert, webhook, cancel, unlink)", async () => {
  const c = new AgentClient({ DB: newD1() });
  const r = await c.tool("register", "register_agent", { name: "golden-bot" });
  c.key = r.data.apiKey;
  const al = await c.tool("alert", "set_alert", { coin: COIN, dir: "above", price: 1.25 });
  await c.tool("webhook", "set_webhook", { url: "https://hooks.example.com/g" });
  await c.tool("cancel", "cancel", { id: al.data.alert.id });
  await c.tool("cancel-again", "cancel", { id: al.data.alert.id });
  await c.tool("unlink", "unlink_wallet");
  golden("onboarding", normalise(c.log));
});

test("golden: error surface an agent can rely on", async () => {
  const c = new AgentClient({ DB: newD1() });
  await c.tool("bad-name", "register_agent", { name: "x" });
  await c.tool("no-key", "set_alert", { coin: COIN, dir: "above", price: 1 });
  await c.tool("dup-1", "register_agent", { name: "dupe-bot" });
  await c.tool("dup-2", "register_agent", { name: "DUPE-BOT" });
  await c.rpc("unknown-tool", "tools/call", { name: "nope", arguments: {} });
  await c.rpc("unknown-method", "bogus/method");
  golden("errors", normalise(c.log));
});

const ids = (o: unknown): unknown => o;
test("golden fixtures are valid JSON-RPC 2.0 transcripts", () => {
  for (const f of ["handshake", "onboarding", "errors"]) {
    const log = JSON.parse(readFileSync(new URL(`./golden/${f}.json`, import.meta.url), "utf8")) as Array<{ request: any; response: any }>;
    assert.ok(log.length > 0);
    for (const e of log) { assert.equal(e.request.jsonrpc, "2.0"); assert.equal(e.response.jsonrpc, "2.0"); assert.equal(e.response.id, e.request.id); assert.ok("result" in e.response !== "error" in e.response); }
  }
  ids(0);
});
test("golden transcripts never contain a raw key or secret", () => {
  for (const f of ["handshake", "onboarding", "errors"]) {
    const t = readFileSync(new URL(`./golden/${f}.json`, import.meta.url), "utf8");
    assert.ok(!/nbk_[0-9a-f]{32}/.test(t));
    assert.ok(!/nbsec_[0-9a-f]{32}/.test(t));
  }
});
