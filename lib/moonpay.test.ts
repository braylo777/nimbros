import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { SOL_WALLET, buildMoonPayQuery, buildSignedUrl, signQuery } from "./moonpay.ts";

const ADDR = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

test("signature matches an independent HMAC-SHA256/base64", async () => {
  const q = buildMoonPayQuery("pk_test_123", ADDR);
  assert.equal(await signQuery(q, "sk_test_secret"), createHmac("sha256", "sk_test_secret").update(q).digest("base64"));
});
test("query is deterministic and targets sol", () => {
  const q = buildMoonPayQuery("pk", ADDR);
  assert.ok(q.startsWith("?apiKey=pk&currencyCode=sol&walletAddress=9xQe"));
  assert.equal(q, buildMoonPayQuery("pk", ADDR));
});
test("signed url is on buy.moonpay.com and carries an encoded signature over the exact query", async () => {
  const u = new URL(await buildSignedUrl("pk", "sk", ADDR));
  assert.equal(u.origin, "https://buy.moonpay.com");
  const sig = u.searchParams.get("signature");
  u.searchParams.delete("signature");
  assert.equal(sig, createHmac("sha256", "sk").update(buildMoonPayQuery("pk", ADDR)).digest("base64"));
});
test("address validation", () => {
  assert.ok(SOL_WALLET.test(ADDR));
  for (const bad of ["0x123", ADDR + "00000000000", ADDR.slice(0, 20), "https://evil", "0OIl" + ADDR.slice(4), ""]) assert.ok(!SOL_WALLET.test(bad), bad);
});
