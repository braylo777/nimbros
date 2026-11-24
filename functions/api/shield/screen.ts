import { isSolAddress } from "../../../lib/chain.ts";
import { rpc } from "../../../lib/solRpc.ts";
import { screenTx, verdictOf, type Finding } from "../../../lib/shield.ts";
import { json, loadActors, type ShieldEnv } from "../../../lib/shieldHttp.ts";
import { rateLimited } from "../../../lib/agentHttp.ts";

/* POST /api/shield/screen {tx: <base64 unsigned transaction>, address: <wallet>} → what the transaction would let happen, before you sign.
   Reads the transaction's own bytes (programs, token approvals, authority changes, SOL leaving) and, when a node is available, simulates it and
   compares your SOL balance before and after. Verdict: safe | review | block. Nothing is signed or stored. */

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function onRequestPost({ request, env }: { request: Request; env: ShieldEnv }): Promise<Response> {
  if (await rateLimited(env, request, "screen", 300)) return json({ error: "Too many requests. Wait a minute and try again." }, 429);
  let body: { tx?: unknown; address?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return json({ error: "bad json" }, 400); }
  const { tx, address } = body;
  if (typeof tx !== "string" || tx.length < 20 || tx.length > 20_000 || !/^[A-Za-z0-9+/=]+$/.test(tx)) return json({ error: "tx must be a base64 transaction" }, 400);
  if (!isSolAddress(address)) return json({ error: "address must be a Solana wallet address" }, 400);

  const actors = new Set((await loadActors(env)).map((a) => a.address));
  const r = screenTx(b64(tx), address, actors);
  const findings: Finding[] = [...r.findings];
  let simulated: { ok: boolean; solDeltaLamports?: string; error?: string } | null = null;
  if (r.verdict !== "block" && env.SOLANA_RPC_URL) {
    try {
      const pre = await rpc<{ value: { lamports: number } | null }>(env, "getAccountInfo", [address, { encoding: "base64" }]);
      const sim = await rpc<{ value: { err: unknown; accounts: ({ lamports: number } | null)[] | null } }>(env, "simulateTransaction", [
        tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: [address] } },
      ]);
      if (sim.value.err !== null) {
        simulated = { ok: false, error: JSON.stringify(sim.value.err).slice(0, 120) };
        findings.push({ level: "warn", code: "SIM_FAILED", message: "A Solana node simulated it and it would fail." });
      } else {
        const delta = BigInt(sim.value.accounts?.[0]?.lamports ?? 0) - BigInt(pre.value?.lamports ?? 0);
        simulated = { ok: true, solDeltaLamports: delta.toString() };
        if (delta < -500_000_000n) findings.push({ level: "warn", code: "SIM_DRAIN", message: `Simulation: your SOL balance would drop by ${(Number(-delta) / 1e9).toFixed(3)} SOL.` });
        else findings.push({ level: "info", code: "SIM_OK", message: `Simulation: your SOL balance would change by ${(Number(delta) / 1e9).toFixed(4)} SOL.` });
      }
    } catch {
      simulated = null; // no node answered: the byte-level rules above still apply
    }
  }
  return json({ verdict: verdictOf(findings), findings, programs: r.programs, simulated });
}
