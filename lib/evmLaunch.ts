import { CHAINS, isChainId, isEvmAddress, type Chain } from "./chains.ts";
import { checkLaunch, type LaunchInput } from "./launch.ts";
import { TOKEN_BYTECODE } from "./erc20Bytecode.ts";
import { deployData } from "./evmAbi.ts";

/* A NimBros launch on an EVM chain: one contract deployment, signed by the launcher's own wallet. The rules are in the contract (see contracts/NimBrosToken.sol):
   the whole supply is minted once to the deployer; there is no owner, mint, burn, pause, blacklist, fee or upgrade. NimBros builds the request, never holds a key. */

export const EVM_DECIMALS = 18;
export type EvmBuild =
  | { ok: true; chain: Chain; input: LaunchInput; data: string }
  | { ok: false; errors: Record<string, string> };

export function buildEvmLaunch(raw: { chain?: unknown; name?: unknown; symbol?: unknown; supplyWhole?: unknown; address?: unknown }): EvmBuild {
  const errors: Record<string, string> = {};
  const chain = isChainId(raw.chain) ? CHAINS[raw.chain] : undefined;
  if (!chain || chain.kind !== "evm") errors.chain = "Choose an EVM chain.";
  if (!isEvmAddress(raw.address)) errors.address = "Connect an EVM wallet.";
  const c = checkLaunch({ name: raw.name, symbol: raw.symbol, supplyWhole: raw.supplyWhole, decimals: EVM_DECIMALS }, [EVM_DECIMALS]);
  if (!c.ok) Object.assign(errors, c.errors);
  if (Object.keys(errors).length || !chain || !c.ok) return { ok: false, errors };
  return { ok: true, chain, input: c.value, data: deployData(TOKEN_BYTECODE, c.value.name, c.value.symbol, EVM_DECIMALS, c.value.supplyWhole) };
}

const hexNum = (h: unknown): bigint | null => (typeof h === "string" && /^0x[0-9a-f]+$/i.test(h) ? BigInt(h) : null);

async function rpcOnce(url: string, method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(6000) });
  const j = (await r.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message ?? "rpc error");
  return j.result;
}

/** Gas and fee estimate from the chain's public nodes (first one that answers). null when none answers: the wallet estimates then. */
export async function estimateLaunch(chain: Chain, from: string, data: string): Promise<{ gas: bigint; gasPriceWei: bigint | null } | null> {
  for (const url of chain.rpcs ?? []) {
    try {
      const gas = hexNum(await rpcOnce(url, "eth_estimateGas", [{ from, data }]));
      if (gas === null) continue;
      const price = hexNum(await rpcOnce(url, "eth_gasPrice", []).catch(() => null));
      return { gas, gasPriceWei: price };
    } catch { /* try the next node */ }
  }
  return null;
}
