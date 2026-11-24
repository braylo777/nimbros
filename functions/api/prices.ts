import { isSolAddress } from "../../lib/chain.ts";

/* GET /api/prices?ids=<mint>,<mint>… (up to 40) → { "<mint>": usdPrice } — live prices from Jupiter's price index, for the
   list cards' price ticks. The page can't call Jupiter itself (its CSP allows only 'self'), and one edge-cached read
   serves every open tab for a couple of seconds. Mints Jupiter has no price for are simply left out. */
export async function onRequestGet({ request }: { request: Request }): Promise<Response> {
  const h = { "content-type": "application/json", "cache-control": "public, s-maxage=2, stale-while-revalidate=5" };
  const ids = (new URL(request.url).searchParams.get("ids") ?? "").split(",").filter(isSolAddress).slice(0, 40);
  if (ids.length === 0) return new Response(JSON.stringify({}), { headers: h });
  try {
    const r = await fetch(`https://lite-api.jup.ag/price/v3?ids=${ids.join(",")}`, { signal: AbortSignal.timeout(4000), cf: { cacheTtl: 2, cacheEverything: true } } as RequestInit);
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as Record<string, { usdPrice?: number } | null>;
    const out: Record<string, number> = {};
    for (const id of ids) { const p = j[id]?.usdPrice; if (typeof p === "number" && p > 0 && Number.isFinite(p)) out[id] = p; }
    return new Response(JSON.stringify(out), { headers: h });
  } catch {
    return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { ...h, "cache-control": "no-store" } });
  }
}
