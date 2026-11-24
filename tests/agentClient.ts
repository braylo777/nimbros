/* A minimal agent client: speaks MCP JSON-RPC to the handler in-process, the way a real agent would over HTTP.
   Used by the golden tests to record what an agent sees. */
import { post } from "./d1shim.ts";
import { onRequestPost as mcp } from "../functions/mcp.ts";

export class AgentClient {
  key?: string;
  log: Array<{ step: string; request: unknown; response: unknown }> = [];
  env: unknown;
  constructor(env: unknown) { this.env = env; }
  async rpc(step: string, method: string, params?: unknown) {
    const request = { jsonrpc: "2.0", id: this.log.length + 1, method, ...(params ? { params } : {}) };
    const r = await mcp({ request: post("/mcp", request, this.key ? { authorization: `Bearer ${this.key}` } : {}), env: this.env as never });
    const response = r.status === 202 ? null : await r.json();
    this.log.push({ step, request, response });
    return response as any;
  }
  async tool(step: string, name: string, args: Record<string, unknown> = {}) {
    const res = await this.rpc(step, "tools/call", { name, arguments: args });
    return { isError: res.result?.isError as boolean, data: JSON.parse(res.result.content[0].text) };
  }
}

/** Replace values that change between runs (ids, keys, secrets) with stable placeholders. */
export function normalise(v: unknown): unknown {
  const s = JSON.stringify(v)
    .replace(/nbk_[0-9a-f]{32}/g, "nbk_<KEY>")
    .replace(/nbsec_[0-9a-f]{32}/g, "nbsec_<SECRET>")
    .replace(/\\"id\\":\\"[0-9a-f]{8,10}\\"/g, '\\"id\\":\\"<ID>\\"')
    .replace(/\\"cancelled\\":\\"[0-9a-f]{8}\\"/g, '\\"cancelled\\":\\"<ID>\\"')
    .replace(/"arguments":\{"id":"[0-9a-f]{8}"\}/g, '"arguments":{"id":"<ID>"}')
    .replace(/"created":\d+/g, '"created":0')
    .replace(/\\"created\\":\d+/g, '\\"created\\":0');
  return JSON.parse(s);
}
