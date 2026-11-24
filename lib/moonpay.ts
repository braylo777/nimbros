/* MoonPay on-ramp (hosted widget, opened in a new tab: MoonPay does the KYC,
   card/bank payment and delivery of SOL to the user's own wallet; NimBros never
   touches fiat or custody). MoonPay requires the widget URL to be signed with
   the account's SECRET key whenever a wallet address is pre-filled, so the URL is
   built and signed server-side (functions/api/moonpay.ts). */

export const MOONPAY_ENABLED = process.env.NEXT_PUBLIC_MOONPAY_ENABLED === "1";
export const SOL_WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Query string (with leading "?") for the widget. Deterministic order: it is what gets signed. */
export function buildMoonPayQuery(apiKey: string, address: string): string {
  const p = new URLSearchParams();
  p.set("apiKey", apiKey);
  p.set("currencyCode", "sol");
  p.set("walletAddress", address);
  p.set("colorCode", "#306AC0");
  return `?${p.toString()}`;
}

/** base64(HMAC-SHA256(secret, "?query")) — MoonPay's documented URL signature. */
export async function signQuery(query: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(query)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function buildSignedUrl(apiKey: string, secret: string, address: string): Promise<string> {
  const q = buildMoonPayQuery(apiKey, address);
  const sig = await signQuery(q, secret);
  return `https://buy.moonpay.com${q}&signature=${encodeURIComponent(sig)}`;
}
