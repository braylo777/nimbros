import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { isSolAddress } from "../../../lib/chain.ts";
import { rpc } from "../../../lib/solRpc.ts";
import { PROGRAMS, REVOKE_DATA, screenTx } from "../../../lib/shield.ts";
import { json, type ShieldEnv } from "../../../lib/shieldHttp.ts";

/* POST /api/shield/revoke {address, accounts: [<token account>, …]} → an UNSIGNED transaction that removes every delegate from those token accounts
   (SPL Token `Revoke`). The owner signs it in their own wallet: NimBros never holds a key or moves anything. Up to 10 accounts per transaction.
   Each account is checked to be a token account owned by `address` before it goes in. */

export async function onRequestPost({ request, env }: { request: Request; env: ShieldEnv }): Promise<Response> {
  let body: { address?: unknown; accounts?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return json({ error: "bad json" }, 400); }
  const { address, accounts } = body;
  if (!isSolAddress(address)) return json({ error: "address must be a Solana wallet address" }, 400);
  if (!Array.isArray(accounts) || accounts.length < 1 || accounts.length > 10 || !accounts.every(isSolAddress)) return json({ error: "accounts must be 1-10 token account addresses" }, 400);
  const list = [...new Set(accounts as string[])];
  try {
    const info = await rpc<{ value: ({ owner: string; data: { parsed?: { type?: string; info?: { owner?: string } } } } | null)[] }>(env, "getMultipleAccounts", [list, { encoding: "jsonParsed" }]);
    const ixs: TransactionInstruction[] = [];
    for (let i = 0; i < list.length; i++) {
      const a = info.value[i];
      if (!a || a.data.parsed?.type !== "account" || a.data.parsed.info?.owner !== address || (a.owner !== PROGRAMS.token && a.owner !== PROGRAMS.token22)) {
        return json({ error: `${list[i]} is not a token account owned by that wallet` }, 422);
      }
      ixs.push(new TransactionInstruction({
        programId: new PublicKey(a.owner),
        keys: [{ pubkey: new PublicKey(list[i]), isSigner: false, isWritable: true }, { pubkey: new PublicKey(address), isSigner: true, isWritable: false }],
        data: Buffer.from(REVOKE_DATA),
      }));
    }
    const bh = await rpc<{ value: { blockhash: string } }>(env, "getLatestBlockhash", [{ commitment: "confirmed" }]);
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(address), recentBlockhash: bh.value.blockhash, instructions: ixs }).compileToV0Message());
    const bytes = tx.serialize();
    // the same screen every other transaction gets: a revoke must come out clean
    const screen = screenTx(bytes, address);
    return json({ ok: true, txBytes: btoa(String.fromCharCode(...bytes)), accounts: list, verdict: screen.verdict });
  } catch {
    return json({ error: "couldn't build the revoke right now" }, 503);
  }
}
