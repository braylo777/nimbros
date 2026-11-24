import { VersionedTransaction } from "@solana/web3.js";

/* Wallet Shield: the pure rules that decide whether a transaction, an approval, a token or a whole wallet looks dangerous.
   No I/O, no clock. Every rule fails toward "review": something we can't read is reported as unknown, never as safe. */

export type Level = "block" | "warn" | "info";
export interface Finding { level: Level; code: string; message: string; ref?: string }
export type Verdict = "safe" | "review" | "block";

export const PROGRAMS = {
  system: "11111111111111111111111111111111",
  compute: "ComputeBudget111111111111111111111111111111",
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token22: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  ata: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  jupiter: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  memo: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  memo1: "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFL",
  metadata: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
} as const;
const KNOWN = new Set<string>(Object.values(PROGRAMS));
const TOKEN_PROGRAMS = new Set<string>([PROGRAMS.token, PROGRAMS.token22]);
const LAMPORTS = 1_000_000_000n;

const u32 = (d: Uint8Array) => (d.length >= 4 ? d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24) : -1) >>> 0;
const u64 = (d: Uint8Array, o: number): bigint => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[o + i] ?? 0);
  return v;
};
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export interface ScreenResult { verdict: Verdict; findings: Finding[]; programs: string[]; solOutLamports: string }

export const verdictOf = (f: Finding[]): Verdict => (f.some((x) => x.level === "block") ? "block" : f.some((x) => x.level === "warn") ? "review" : "safe");

/**
 * Read an unsigned transaction's own bytes and say what it would let happen. `actors` = addresses known to be malicious.
 * Accounts that live in address lookup tables can't be named from the bytes, so a rule that needs one says so instead of guessing.
 */
export function screenTx(bytes: Uint8Array, address: string, actors: ReadonlySet<string> = new Set()): ScreenResult {
  const findings: Finding[] = [];
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(bytes);
  } catch {
    return { verdict: "block", findings: [{ level: "block", code: "UNREADABLE", message: "This isn't a Solana transaction we can read. Don't sign it." }], programs: [], solOutLamports: "0" };
  }
  const msg = tx.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const name = (i: number): string | null => (i < keys.length ? keys[i] : null);
  const signers = keys.slice(0, msg.header.numRequiredSignatures);
  if (!signers.includes(address)) findings.push({ level: "warn", code: "NOT_SIGNER", message: "Your wallet isn't one of the signers, so this transaction isn't really yours." });
  if (signers.length > 1) findings.push({ level: "warn", code: "CO_SIGNERS", message: `It needs ${signers.length - 1} other signature(s). A co-signer you don't know can change what it does.` });
  if (signers[0] && signers[0] !== address) findings.push({ level: "warn", code: "PAYER", message: `Someone else (${short(signers[0])}) pays the fee.` });
  for (const k of keys) if (actors.has(k)) findings.push({ level: "block", code: "KNOWN_ACTOR", message: `It involves ${short(k)}, a wallet on the NimBros scam watchlist.`, ref: k });

  const programs = new Set<string>();
  let solOut = 0n;
  for (const ix of msg.compiledInstructions) {
    const prog = name(ix.programIdIndex);
    if (!prog) { findings.push({ level: "warn", code: "PROGRAM_HIDDEN", message: "An instruction's program can't be read from the transaction." }); continue; }
    programs.add(prog);
    const d = ix.data;
    const acct = (n: number) => { const i = ix.accountKeyIndexes[n]; return i === undefined ? null : name(i); };
    if (!KNOWN.has(prog)) {
      findings.push({ level: "warn", code: "UNKNOWN_PROGRAM", message: `It calls a program NimBros doesn't recognise (${short(prog)}). That can be a legitimate DEX or something malicious.`, ref: prog });
      continue;
    }
    if (prog === PROGRAMS.system) {
      const kind = u32(d);
      if (kind === 2 && acct(0) === address) solOut += u64(d, 4);
      else if (kind === 11 && acct(1) === address) solOut += u64(d, 4);
      // CreateAccount and CreateAccountWithSeed move lamports out of the funding account exactly like a Transfer does, and
      // CreateAccountWithSeed needs no second signer (the new address is derived, not a fresh keypair) — so without this a
      // transaction that drains the wallet through account creation alone would produce no findings at all.
      else if (kind === 0 && acct(0) === address) solOut += u64(d, 4);
      else if (kind === 3 && acct(0) === address) { const seedLen = Number(u64(d, 36)); solOut += u64(d, 44 + seedLen); }
      else if (kind === 1 || kind === 10) findings.push({ level: "block", code: "ASSIGN", message: "It reassigns an account to another program: the way wallets get taken over.", ref: acct(0) ?? undefined });
      else if (kind === 4 || kind === 5 || kind === 7) findings.push({ level: "warn", code: "NONCE", message: "It uses a durable nonce, which lets a signed transaction be replayed later." });
    } else if (TOKEN_PROGRAMS.has(prog)) {
      const kind = d[0];
      if (kind === 4 || kind === 13) {
        const delegate = acct(kind === 4 ? 1 : 2);
        findings.push({ level: "block", code: "APPROVE", message: `It gives ${delegate ? short(delegate) : "someone"} the right to spend your tokens. A swap never needs this.`, ref: delegate ?? undefined });
      } else if (kind === 6 && d[2] === 0 && (d[1] === 0 || d[1] === 1)) { // only the mint or freeze authority, and only to nobody
        findings.push({ level: "info", code: "REVOKE_AUTHORITY", message: "It permanently removes an authority (nobody will hold it afterwards). That protects buyers." });
      } else if (kind === 6 || kind === 21 || kind === 22) {
        findings.push({ level: "block", code: "SET_AUTHORITY", message: "It hands control of a token account or mint to another address." });
      } else if (kind === 9) {
        const dest = acct(1);
        if (dest && dest !== address) findings.push({ level: "block", code: "CLOSE_TO_OTHER", message: `It closes a token account and sends the leftover SOL to ${short(dest)}, not to you.`, ref: dest });
        else if (!dest) findings.push({ level: "warn", code: "CLOSE_HIDDEN", message: "It closes a token account and the destination can't be read." });
      } else if (kind === 3 || kind === 12) {
        const dest = acct(kind === 3 ? 1 : 2);
        findings.push({ level: "warn", code: "TOKEN_OUT", message: `It moves tokens out of your wallet${dest ? ` to ${short(dest)}` : ""}.`, ref: dest ?? undefined });
      } else if (kind === 8 || kind === 15) {
        findings.push({ level: "warn", code: "BURN", message: "It burns tokens from your wallet." });
      }
    }
  }
  if (solOut > 0n) {
    const sol = Number(solOut) / 1e9;
    findings.push({ level: solOut >= LAMPORTS / 2n ? "warn" : "info", code: "SOL_OUT", message: `It sends ${sol.toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL out of your wallet (a swap's wrap and fee transfers show up here).` });
  }
  return { verdict: verdictOf(findings), findings, programs: [...programs], solOutLamports: solOut.toString() };
}

/* ---- approvals: what other addresses are allowed to do with your tokens ---- */
export interface TokenAcct { pubkey: string; mint: string; program: string; amount: string; decimals: number; delegate?: string; delegatedAmount?: string; frozen: boolean; closeAuthority?: string }

export function assessApprovals(accts: readonly TokenAcct[], actors: ReadonlySet<string> = new Set()): Finding[] {
  const out: Finding[] = [];
  for (const a of accts) {
    if (a.delegate && BigInt(a.delegatedAmount ?? "0") > 0n) {
      const bad = actors.has(a.delegate);
      const whole = BigInt(a.delegatedAmount ?? "0") >= BigInt(a.amount) && BigInt(a.amount) > 0n;
      out.push({
        level: bad ? "block" : "warn",
        code: bad ? "DELEGATE_ACTOR" : "DELEGATE",
        message: `${short(a.delegate)} can spend ${whole ? "all of" : "part of"} your ${short(a.mint)} until you revoke it${bad ? " (a wallet on the scam watchlist)" : ""}.`,
        ref: a.pubkey,
      });
    }
    if (a.frozen) out.push({ level: "info", code: "FROZEN", message: `Your ${short(a.mint)} account is frozen (common with airdropped spam): you can't move it, but it can't hurt the rest of your wallet.`, ref: a.pubkey });
    if (a.closeAuthority && a.closeAuthority.length > 0) out.push({ level: "info", code: "CLOSE_AUTH", message: `Someone else (${short(a.closeAuthority)}) can close your ${short(a.mint)} account.`, ref: a.pubkey });
  }
  return out;
}

/* ---- tokens ---- */
export interface TokenFactsLite { mintDisabled?: boolean; freezeDisabled?: boolean; top10Pct?: number; holders?: number; devMints?: number; devMigrations?: number }
export function assessToken(mint: string, f: TokenFactsLite | null): Finding[] {
  if (!f) return [{ level: "info", code: "TOKEN_UNKNOWN", message: `${short(mint)}: no safety data available. Treat as unverified.`, ref: mint }];
  const out: Finding[] = [];
  if (f.mintDisabled === false) out.push({ level: "warn", code: "MINT_LIVE", message: `${short(mint)}: the creator can still print more.`, ref: mint });
  if (f.freezeDisabled === false) out.push({ level: "warn", code: "FREEZE_LIVE", message: `${short(mint)}: the creator can freeze your tokens.`, ref: mint });
  if (f.top10Pct !== undefined && f.top10Pct >= 60) out.push({ level: "warn", code: "CONCENTRATED", message: `${short(mint)}: the top 10 wallets hold ${f.top10Pct.toFixed(0)}%.`, ref: mint });
  if (f.devMints !== undefined && f.devMints >= 20 && (f.devMigrations ?? 0) < f.devMints / 10) out.push({ level: "warn", code: "SERIAL_DEPLOYER", message: `${short(mint)}: its deployer has launched ${f.devMints} coins and few ever graduated.`, ref: mint });
  return out;
}

/* ---- the wallet as a whole ---- */
export type RiskLevel = "safe" | "attention" | "danger";
export function walletRisk(findings: readonly Finding[]): { score: number; level: RiskLevel } {
  let score = 100, warnCost = 0;
  for (const f of findings) {
    if (f.level === "block") score -= 40;
    else if (f.level === "warn") warnCost += 12;
  }
  score = Math.max(0, score - Math.min(warnCost, 50)); // many small warnings (a wallet full of airdropped junk) shouldn't read as a break-in
  return { score, level: findings.some((f) => f.level === "block") || score < 50 ? "danger" : score < 80 ? "attention" : "safe" };
}

/** SPL Token `Revoke` (instruction 5): data is one byte; accounts are the token account then its owner (signer). */
export const REVOKE_DATA = Uint8Array.of(5);
