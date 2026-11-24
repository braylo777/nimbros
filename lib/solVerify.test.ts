import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import bs58 from "bs58";
import { verifySolMessage } from "./solVerify.ts";

const wallet = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const address = bs58.encode(Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url"));
  return { address, sig: (m: string) => sign(null, Buffer.from(m), privateKey).toString("base64") };
};
const enc = (s: string) => new TextEncoder().encode(s);

test("a valid signature verifies and returns the address", () => {
  const w = wallet();
  assert.equal(verifySolMessage(enc("hello"), w.sig("hello"), w.address), w.address);
});
test("wrong message, wrong wallet, junk and malformed input all throw", () => {
  const a = wallet(), b = wallet();
  assert.throws(() => verifySolMessage(enc("other"), a.sig("hello"), a.address));
  assert.throws(() => verifySolMessage(enc("hello"), a.sig("hello"), b.address));
  assert.throws(() => verifySolMessage(enc("hello"), "not-a-signature", a.address));
  assert.throws(() => verifySolMessage(enc("hello"), a.sig("hello"), "not-an-address"));
  assert.throws(() => verifySolMessage(enc("hello"), "", a.address));
});
