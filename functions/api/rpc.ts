import { rpcUrl, type RpcEnv } from "../../lib/solRpc.ts";

/* POST /api/rpc — a JSON-RPC pass-through for the wallet layer. The page's CSP only allows 'self', and the node URL
   (which may carry a paid API key) must never reach the browser, so the browser talks to this and we talk to the node.
   Only the methods a wallet flow needs are forwarded; anything else is refused. */

const ALLOW = new Set([
  "getBalance", "getLatestBlockhash", "getBlockHeight", "getSignatureStatuses", "sendTransaction", "simulateTransaction",
  "getAccountInfo", "getMultipleAccounts", "getTokenAccountsByOwner", "getTokenAccountBalance", "getTokenSupply",
  "getMinimumBalanceForRentExemption", "getFeeForMessage", "getSlot", "getTransaction", "isBlockhashValid", "getVersion", "getGenesisHash",
]);

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestPost({ request, env }: { request: Request; env: RpcEnv }): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 20) return json({ error: "1-20 calls per request" }, 400);
  for (const c of calls) {
    const m = (c as { method?: unknown })?.method;
    if (typeof m !== "string" || !ALLOW.has(m)) return json({ jsonrpc: "2.0", id: (c as { id?: unknown })?.id ?? null, error: { code: -32601, message: `method not allowed: ${String(m).slice(0, 40)}` } }, 403);
  }
  try {
    const r = await fetch(rpcUrl(env), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    return new Response(r.body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return json({ error: "rpc unavailable" }, 502);
  }
}
