import { SOL_WALLET, buildSignedUrl } from "../../lib/moonpay.ts";

/* GET /api/moonpay?address=<wallet> -> { url } — a MoonPay widget URL pre-filled for SOL
   and signed with the SECRET key (set as a Cloudflare Pages secret; never in the
   browser bundle). Only the wallet address is taken from the caller, strictly
   validated; nothing else is user-controlled. 503 when not configured. */

interface Env { MOONPAY_PUBLIC_KEY?: string; MOONPAY_SECRET_KEY?: string }

export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!SOL_WALLET.test(address)) return new Response("bad request", { status: 400 });
  if (!env.MOONPAY_PUBLIC_KEY || !env.MOONPAY_SECRET_KEY) {
    return new Response(JSON.stringify({ error: "not configured" }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const url = await buildSignedUrl(env.MOONPAY_PUBLIC_KEY, env.MOONPAY_SECRET_KEY, address);
  return new Response(JSON.stringify({ url }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
