import { PublicKey } from "@solana/web3.js";
import { isSolAddress } from "../../../lib/chain.ts";
import { buildLaunchTx, checkLaunch } from "../../../lib/launch.ts";
import { rpc } from "../../../lib/solRpc.ts";
import { screenTx } from "../../../lib/shield.ts";
import { json, type ShieldEnv } from "../../../lib/shieldHttp.ts";
import { bump } from "../../../lib/counter.ts";

/* POST /api/launch/build {name, symbol, supplyWhole, decimals?, address, mint} → an UNSIGNED launch transaction for the launcher's own wallet.
   `mint` is the public key of a fresh keypair the launcher's browser generated (its secret never leaves the browser). The transaction mints the whole
   supply once to `address`, writes immutable name + symbol metadata, then permanently revokes the mint authority; there is no freeze authority.
   It is simulated and screened by Shield before it is returned, and refused if either says no. 3 builds per wallet per day. */

export async function onRequestPost({ request, env }: { request: Request; env: ShieldEnv & { DB?: import("../../../lib/accountStore.ts").D1 } }): Promise<Response> {
  let b: Record<string, unknown>;
  try { b = (await request.json()) as Record<string, unknown>; } catch { return json({ error: "bad json" }, 400); }
  const checked = checkLaunch(b);
  if (!checked.ok) return json({ error: "That didn't pass the checks.", errors: checked.errors }, 422);
  if (!isSolAddress(b.address) || !isSolAddress(b.mint)) return json({ error: "address and mint must be Solana public keys" }, 400);
  if (b.address === b.mint) return json({ error: "the mint must be a new key, not your wallet" }, 400);
  try {
    if (env.DB && (await bump(env.DB, `launch:${b.address}`, 86_400_000)) > 3) return json({ error: "3 launches a day per wallet. Try again tomorrow." }, 429);
    const owner = new PublicKey(b.address), mint = new PublicKey(b.mint);
    const [rent, bh] = await Promise.all([
      rpc<number>(env, "getMinimumBalanceForRentExemption", [82]),
      rpc<{ value: { blockhash: string } }>(env, "getLatestBlockhash", [{ commitment: "confirmed" }]),
    ]);
    const bytes = buildLaunchTx({ owner, mint, input: checked.value, mintRentLamports: rent, blockhash: bh.value.blockhash });
    const screen = screenTx(bytes, owner.toBase58());
    if (screen.verdict === "block") return json({ error: "Shield refused this launch transaction.", findings: screen.findings }, 422);
    const tx = btoa(String.fromCharCode(...bytes));
    // dry run: the launcher's balance must cover rent + fees, and every instruction must succeed (the new mint's signature isn't needed to simulate)
    const sim = await rpc<{ value: { err: unknown; logs?: string[] } }>(env, "simulateTransaction", [tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
    if (sim.value.err !== null) {
      const lack = JSON.stringify(sim.value.err).includes("InsufficientFunds") || JSON.stringify(sim.value.err).includes("AccountNotFound");
      return json({ error: lack ? "This wallet doesn't have enough SOL for the launch (about 0.02 SOL)." : "The launch didn't pass a dry run, so it was not offered for signing.", detail: JSON.stringify(sim.value.err).slice(0, 160) }, 422);
    }
    return json({ ok: true, txBytes: tx, mint: mint.toBase58(), supplyWhole: checked.value.supplyWhole.toString(), decimals: checked.value.decimals, screen: { verdict: screen.verdict, findings: screen.findings } });
  } catch {
    return json({ error: "couldn't build the launch right now" }, 503);
  }
}
