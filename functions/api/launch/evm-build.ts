import { buildEvmLaunch, estimateLaunch } from "../../../lib/evmLaunch.ts";
import { json, rateLimited } from "../../../lib/agentHttp.ts";

/* POST /api/launch/evm-build {chain, name, symbol, supplyWhole, address} → the deployment request the launcher's wallet will be asked to sign.
   Nothing is signed or stored here. The reply carries the creation data, a gas limit (the chain's own estimate plus 25%) and a fee estimate. */
export async function onRequestPost({ request, env }: { request: Request; env: import("../../../lib/agentHttp.ts").Env }): Promise<Response> {
  if (await rateLimited(env, request, "evmlaunch", 20)) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return json({ error: "bad json" }, 400); }
  const b = buildEvmLaunch(body);
  if (!b.ok) return json({ error: "Check the highlighted fields.", errors: b.errors }, 422);
  const est = await estimateLaunch(b.chain, String(body.address), b.data);
  const gas = est ? (est.gas * 125n) / 100n : 1_500_000n;
  const feeNative = est?.gasPriceWei ? Number(est.gas * est.gasPriceWei) / 1e18 : null;
  return json({ chain: b.chain.id, evmId: b.chain.evmId, native: b.chain.native, data: b.data, gas: Number(gas), estimated: !!est, feeNative, decimals: b.input.decimals, symbol: b.input.symbol, name: b.input.name, supplyWhole: b.input.supplyWhole.toString() });
}
