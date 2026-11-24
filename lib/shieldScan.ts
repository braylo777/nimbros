import { rpc } from "./solRpc.ts";
import { tokenFacts } from "./tokenIndex.ts";
import { assessApprovals, assessToken, walletRisk, type Finding } from "./shield.ts";
import { loadActors, recentSignatures, tokenAccounts, type ShieldEnv } from "./shieldHttp.ts";

/* One wallet health check, shared by GET /api/shield/scan and the background watcher. */
export async function scanWallet(env: ShieldEnv, address: string) {
  const degraded: string[] = [];
  const actors = await loadActors(env);
  const bad = new Set(actors.map((a) => a.address));
  const findings: Finding[] = [];
  if (bad.has(address)) findings.push({ level: "block", code: "WALLET_LISTED", message: "This wallet is on the NimBros scam watchlist." });

  const [sol, accts, sigs] = await Promise.all([
    rpc<{ value: number }>(env, "getBalance", [address, { commitment: "confirmed" }]).then((r) => r.value).catch(() => { degraded.push("SOL balance"); return null; }),
    tokenAccounts(env, address).catch(() => { degraded.push("token accounts and approvals (this RPC node refuses indexed reads)"); return null; }),
    recentSignatures(env, address).catch(() => { degraded.push("recent activity"); return null; }),
  ]);

  let holdings: { mint: string; pubkey: string; amount: string; decimals: number; ui: number; findings: Finding[] }[] = [];
  if (accts) {
    findings.push(...assessApprovals(accts, bad));
    const live = accts.filter((a) => BigInt(a.amount) > 0n).sort((a, b) => Number(BigInt(b.amount) / 10n ** BigInt(b.decimals)) - Number(BigInt(a.amount) / 10n ** BigInt(a.decimals))).slice(0, 10);
    const facts = await Promise.all(live.map((a) => tokenFacts(a.mint)));
    holdings = live.map((a, i) => {
      const f = assessToken(a.mint, facts[i] ? { ...facts[i]! } : null);
      findings.push(...f.filter((x) => x.level !== "info"));
      return { mint: a.mint, pubkey: a.pubkey, amount: a.amount, decimals: a.decimals, ui: Number(a.amount) / 10 ** a.decimals, findings: f };
    });
    if (accts.length > live.length) degraded.push(`only the ${live.length} largest of ${accts.filter((a) => BigInt(a.amount) > 0n).length} holdings were checked`);
  }
  const { score, level } = walletRisk(findings);
  return ({
    address, sol: sol === null ? null : sol / 1e9, score, level, findings, holdings,
    approvals: accts ? accts.filter((a) => a.delegate && BigInt(a.delegatedAmount ?? "0") > 0n).map((a) => ({ account: a.pubkey, mint: a.mint, delegate: a.delegate, amount: a.delegatedAmount })) : null,
    recent: sigs, degraded, complete: sol !== null && accts !== null && sigs !== null, ts: Date.now(),
  });
}
