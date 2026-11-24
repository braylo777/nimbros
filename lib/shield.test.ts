import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { PROGRAMS, assessApprovals, assessToken, screenTx, walletRisk, type TokenAcct } from "./shield.ts";

const me = Keypair.generate().publicKey;
const other = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const acct = Keypair.generate().publicKey;
const TOKEN = new PublicKey(PROGRAMS.token);

const build = (ixs: TransactionInstruction[], payer = me) =>
  new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: ixs }).compileToV0Message()).serialize();
const tokIx = (data: number[], keys: PublicKey[]) => new TransactionInstruction({ programId: TOKEN, keys: keys.map((k, i) => ({ pubkey: k, isSigner: i === keys.length - 1 && data[0] !== 5 ? false : false, isWritable: true })), data: Buffer.from(data) });
const codes = (r: ReturnType<typeof screenTx>) => r.findings.map((f) => f.code);

test("a plain small transfer is only informational", () => {
  const r = screenTx(build([SystemProgram.transfer({ fromPubkey: me, toPubkey: other, lamports: 1000 })]), me.toBase58());
  assert.equal(r.verdict, "safe");
  assert.deepEqual(codes(r), ["SOL_OUT"]);
});
test("a big SOL transfer asks for review", () => {
  const r = screenTx(build([SystemProgram.transfer({ fromPubkey: me, toPubkey: other, lamports: 600_000_000 })]), me.toBase58());
  assert.equal(r.verdict, "review");
});
test("draining the wallet via CreateAccount is caught, not silently 'safe'", () => {
  const created = Keypair.generate();
  const r = screenTx(build([SystemProgram.createAccount({ fromPubkey: me, newAccountPubkey: created.publicKey, lamports: 900_000_000, space: 0, programId: SystemProgram.programId })]), me.toBase58());
  assert.equal(r.verdict, "review");
  assert.ok(codes(r).includes("SOL_OUT"));
});
test("draining the wallet via CreateAccountWithSeed needs no co-signer and was previously invisible to screenTx — must be caught now", async () => {
  // the created address is derived (base+seed+owner), so this instruction alone needs only the funding account's signature: a real
  // one-instruction wallet-drain that a co-signer/approval-style check would never see.
  const newAccountPubkey = await PublicKey.createWithSeed(me, "drain", SystemProgram.programId);
  const r = screenTx(build([SystemProgram.createAccountWithSeed({ fromPubkey: me, newAccountPubkey, basePubkey: me, seed: "drain", lamports: 900_000_000, space: 0, programId: SystemProgram.programId })]), me.toBase58());
  assert.equal(r.verdict, "review");
  assert.ok(codes(r).includes("SOL_OUT"));
});
test("a small CreateAccountWithSeed (a normal token-account rent payment) is not falsely flagged as a review-worthy drain", async () => {
  const newAccountPubkey = await PublicKey.createWithSeed(me, "rent", TOKEN);
  const r = screenTx(build([SystemProgram.createAccountWithSeed({ fromPubkey: me, newAccountPubkey, basePubkey: me, seed: "rent", lamports: 2_039_280, space: 165, programId: TOKEN })]), me.toBase58());
  assert.equal(r.verdict, "safe");
  assert.deepEqual(codes(r), ["SOL_OUT"]);
});
test("an SPL approve is blocked (a swap never needs it)", () => {
  const r = screenTx(build([tokIx([4, 1, 0, 0, 0, 0, 0, 0, 0], [acct, other, me])]), me.toBase58());
  assert.equal(r.verdict, "block");
  assert.ok(codes(r).includes("APPROVE"));
});
test("set-authority and closing an account into someone else's wallet are blocked", () => {
  assert.ok(codes(screenTx(build([tokIx([6, 2, 0], [acct, me])]), me.toBase58())).includes("SET_AUTHORITY"));
  const close = screenTx(build([tokIx([9], [acct, other, me])]), me.toBase58());
  assert.ok(codes(close).includes("CLOSE_TO_OTHER"));
  assert.equal(screenTx(build([tokIx([9], [acct, me, me])]), me.toBase58()).verdict, "safe");
});
test("revoking an authority (new authority = none) is fine, handing it to someone is not", () => {
  const revoke = screenTx(build([tokIx([6, 0, 0], [acct, me])]), me.toBase58());
  assert.equal(revoke.verdict, "safe");
  const handOver = screenTx(build([tokIx([6, 0, 1, ...other.toBytes()], [acct, me])]), me.toBase58());
  assert.equal(handOver.verdict, "block");
});
test("a system assign is blocked", () => {
  const r = screenTx(build([SystemProgram.assign({ accountPubkey: me, programId: other })]), me.toBase58());
  assert.equal(r.verdict, "block");
});
test("an unknown program and someone else paying both need review", () => {
  const ix = new TransactionInstruction({ programId: other, keys: [], data: Buffer.from([1]) });
  assert.ok(codes(screenTx(build([ix]), me.toBase58())).includes("UNKNOWN_PROGRAM"));
  assert.ok(codes(screenTx(build([ix], other), me.toBase58())).includes("PAYER"));
});
test("anything on the scam watchlist is blocked, and garbage bytes are blocked", () => {
  const r = screenTx(build([SystemProgram.transfer({ fromPubkey: me, toPubkey: other, lamports: 1 })]), me.toBase58(), new Set([other.toBase58()]));
  assert.equal(r.verdict, "block");
  assert.equal(screenTx(new Uint8Array([1, 2, 3]), me.toBase58()).verdict, "block");
});

const ta = (o: Partial<TokenAcct>): TokenAcct => ({ pubkey: acct.toBase58(), mint: mint.toBase58(), program: PROGRAMS.token, amount: "100", decimals: 6, frozen: false, ...o });
test("approvals: an active delegate warns, a watchlisted one blocks, none is clean", () => {
  assert.deepEqual(assessApprovals([ta({})]), []);
  assert.equal(assessApprovals([ta({ delegate: other.toBase58(), delegatedAmount: "100" })])[0].level, "warn");
  assert.equal(assessApprovals([ta({ delegate: other.toBase58(), delegatedAmount: "1" })], new Set([other.toBase58()]))[0].level, "block");
  assert.deepEqual(assessApprovals([ta({ delegate: other.toBase58(), delegatedAmount: "0" })]), []);
  assert.equal(assessApprovals([ta({ frozen: true })])[0].level, "info");
});
test("tokens: live authorities, concentration and serial deployers warn; unknown is info, never safe", () => {
  const m = mint.toBase58();
  assert.deepEqual(assessToken(m, { mintDisabled: true, freezeDisabled: true, top10Pct: 20 }), []);
  assert.deepEqual(assessToken(m, { mintDisabled: false, freezeDisabled: false, top10Pct: 80, devMints: 50, devMigrations: 1 }).map((f) => f.code), ["MINT_LIVE", "FREEZE_LIVE", "CONCENTRATED", "SERIAL_DEPLOYER"]);
  assert.equal(assessToken(m, null)[0].level, "info");
});
test("wallet risk: clean is safe, warnings cost points, any block is danger", () => {
  assert.equal(walletRisk([]).level, "safe");
  assert.equal(walletRisk(Array.from({ length: 30 }, () => ({ level: "warn" as const, code: "x", message: "" }))).level, "attention"); // many warnings alone never read as a break-in
  assert.equal(walletRisk([{ level: "warn", code: "x", message: "" }, { level: "warn", code: "y", message: "" }]).level, "attention");
  assert.equal(walletRisk([{ level: "block", code: "x", message: "" }]).level, "danger");
  assert.equal(walletRisk([{ level: "info", code: "x", message: "" }]).score, 100);
});
