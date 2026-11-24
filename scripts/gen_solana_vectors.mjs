import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
const seed = new Uint8Array(32); for (let i = 0; i < 32; i++) seed[i] = i + 1;
const pub = ed25519.getPublicKey(seed);
const address = bs58.encode(pub);
const msg = Uint8Array.from(Buffer.from("nimbros-link:abc123"));
const sig = ed25519.sign(msg, seed);
console.log(JSON.stringify({
  seedHex: Buffer.from(seed).toString("hex"),
  pubHex: Buffer.from(pub).toString("hex"),
  address,
  msgUtf8: "nimbros-link:abc123",
  sigB64: Buffer.from(sig).toString("base64"),
  sigB58: bs58.encode(sig),
}, null, 2));
