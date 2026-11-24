import { ed25519 } from "@noble/curves/ed25519.js";
import { isSolAddress } from "./chain.ts";

/* Proof of wallet ownership. Wallets sign a plain message (Solana has no "personal message" envelope): an ed25519
   signature over the raw UTF-8 bytes. The address IS the public key, so verifying needs the claimed address. */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function bs58decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.push(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c === "1") bytes.push(0); else break; }
  return Uint8Array.from(bytes.reverse());
}

const fromB64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Throws unless `signatureB64` is `address`'s valid ed25519 signature over `message`. Returns the address. */
export function verifySolMessage(message: Uint8Array, signatureB64: string, address: string): string {
  if (!isSolAddress(address)) throw new Error("bad address");
  const pk = bs58decode(address);
  const sig = fromB64(signatureB64);
  if (pk.length !== 32 || sig.length !== 64) throw new Error("bad key or signature length");
  if (!ed25519.verify(sig, message, pk)) throw new Error("signature does not match");
  return address;
}
