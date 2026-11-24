import { PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

/* NimBros-native coin launch on Solana. The rules of the launch are fixed in the transaction itself, so a buyer can verify them on chain:
   - the whole supply is minted once, to the launcher's own wallet
   - the mint authority is then permanently revoked (nobody can print more), and there is NO freeze authority (nobody can lock holders)
   - the name and symbol are written to Metaplex metadata that is immutable
   NimBros builds the UNSIGNED transaction; the launcher signs with their own wallet (and the new mint's key, held only in their browser).
   NimBros never holds a key, a fund or the coin. */

export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const MINT_SIZE = 82;

export const SUPPLY_CHOICES = [1_000_000n, 10_000_000n, 100_000_000n, 1_000_000_000n, 10_000_000_000n] as const;
export const DECIMAL_CHOICES = [6, 9] as const;

export interface LaunchInput { name: string; symbol: string; supplyWhole: bigint; decimals: number }

/* names people impersonate: exact and look-alike matches are refused */
const RESERVED = ["ARB", "OP", "MATIC", "POL", "AVAX", "LINK", "UNI", "AAVE", "PEPE", "CAKE", "BASE", "USDS", "DAI", "SOL", "WSOL", "USDC", "USDT", "PYUSD", "BTC", "WBTC", "ETH", "WETH", "BNB", "XRP", "DOGE", "SHIB", "BONK", "WIF", "JUP", "JTO", "RAY", "PYTH", "TRUMP", "PUMP", "NIMBROS", "NMBR", "NIMBUS", "PHANTOM", "SOLANA", "BINANCE", "COINBASE"];
const fold = (s: string) => s.toUpperCase().replace(/0/g, "O").replace(/[1IL]/g, "I").replace(/5/g, "S").replace(/8/g, "B");
function editDistanceOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diffs = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diffs > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diffs + (a.length - i) + (b.length - j) <= 1;
}
export const looksReserved = (symbol: string, name = ""): boolean => {
  const s = fold(symbol), n = fold(name).replace(/[^A-Z0-9]/g, "");
  return RESERVED.some((r) => { const f = fold(r); return s === f || n === f || (f.length >= 4 && (editDistanceOne(s, f) || editDistanceOne(n, f))); });
};

export type Checked = { ok: true; value: LaunchInput } | { ok: false; errors: Record<string, string> };
export function checkLaunch(raw: { name?: unknown; symbol?: unknown; supplyWhole?: unknown; decimals?: unknown }, decimalChoices: readonly number[] = DECIMAL_CHOICES): Checked {
  const errors: Record<string, string> = {};
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
  if (name.length < 2 || name.length > 32 || !/^[\x20-\x7E]+$/.test(name)) errors.name = "2 to 32 plain characters.";
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) errors.symbol = "2 to 10 characters, A to Z and 0 to 9.";
  let supply = 0n;
  try { supply = BigInt(String(raw.supplyWhole ?? "")); } catch { /* handled below */ }
  if (!SUPPLY_CHOICES.includes(supply as (typeof SUPPLY_CHOICES)[number])) errors.supplyWhole = "Choose 1M, 10M, 100M, 1B or 10B.";
  const decimals = Number(raw.decimals ?? 6);
  if (!decimalChoices.includes(decimals)) errors.decimals = `Decimals must be ${decimalChoices.join(" or ")}.`;
  if (!errors.symbol && looksReserved(symbol, name)) errors.symbol = "That symbol or name imitates an established coin.";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { name, symbol, supplyWhole: supply, decimals } };
}

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const borshStr = (s: string) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });

export const metadataPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM)[0];
export const ataOf = (owner: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];

/** The six instructions of a launch, in order. Metadata is written BEFORE the mint authority is revoked (it needs that authority's signature). */
export function launchInstructions(a: { owner: PublicKey; mint: PublicKey; input: LaunchInput; mintRentLamports: number }): TransactionInstruction[] {
  const { owner, mint, input } = a;
  const ata = ataOf(owner, mint);
  const raw = input.supplyWhole * 10n ** BigInt(input.decimals);
  return [
    SystemProgram.createAccount({ fromPubkey: owner, newAccountPubkey: mint, lamports: a.mintRentLamports, space: MINT_SIZE, programId: TOKEN_PROGRAM }),
    // InitializeMint2: mint authority = the launcher, freeze authority = none
    new TransactionInstruction({ programId: TOKEN_PROGRAM, keys: [meta(mint, false, true)], data: Buffer.concat([Buffer.from([20, input.decimals]), owner.toBuffer(), Buffer.from([0])]) }),
    // the launcher's token account (idempotent: fine if it already exists)
    new TransactionInstruction({ programId: ATA_PROGRAM, keys: [meta(owner, true, true), meta(ata, false, true), meta(owner, false, false), meta(mint, false, false), meta(SystemProgram.programId, false, false), meta(TOKEN_PROGRAM, false, false)], data: Buffer.from([1]) }),
    // MintTo: the whole supply, once
    new TransactionInstruction({ programId: TOKEN_PROGRAM, keys: [meta(mint, false, true), meta(ata, false, true), meta(owner, true, false)], data: Buffer.concat([Buffer.from([7]), u64(raw)]) }),
    // CreateMetadataAccountV3: name + symbol, no image or link (those are the launcher's to add elsewhere), is_mutable = false
    new TransactionInstruction({
      programId: METADATA_PROGRAM,
      keys: [meta(metadataPda(mint), false, true), meta(mint, false, false), meta(owner, true, false), meta(owner, true, true), meta(owner, false, false), meta(SystemProgram.programId, false, false)],
      data: Buffer.concat([Buffer.from([33]), borshStr(input.name), borshStr(input.symbol), borshStr(""), Buffer.from([0, 0]), Buffer.from([0]), Buffer.from([0]), Buffer.from([0]), Buffer.from([0]), Buffer.from([0])]),
    }),
    // SetAuthority(MintTokens -> none): nobody can ever print more
    new TransactionInstruction({ programId: TOKEN_PROGRAM, keys: [meta(mint, false, true), meta(owner, true, false)], data: Buffer.from([6, 0, 0]) }),
  ];
}

export function buildLaunchTx(a: { owner: PublicKey; mint: PublicKey; input: LaunchInput; mintRentLamports: number; blockhash: string }): Uint8Array {
  const msg = new TransactionMessage({ payerKey: a.owner, recentBlockhash: a.blockhash, instructions: launchInstructions(a) }).compileToV0Message();
  return new VersionedTransaction(msg).serialize();
}
