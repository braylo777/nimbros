import { evmSourceUrls, isEvmChain, normalizeEvmPools, splitEvmTokens } from "../../lib/evmFeed.ts";
import { rateLimited, type Env } from "../../lib/agentHttp.ts";

/* GET /api/evm-feed?chain=bsc&k=snipe|scalp — read-only browse for the EVM chains, cached at the edge and in KV the same way the Solana
   feed is. No trading here: the point is to show real coins are real, before EVM trading exists. See lib/evmFeed.ts and
   .claude/brain/multichain-launch.md. */
const json = (b: unknown, status = 200, cache = "no-store") => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": cache } });
const KV_TTL_S = 4 * 3600;

export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const u = new URL(request.url);
  const chain = u.searchParams.get("chain") ?? "";
  const k = u.searchParams.get("k");
  if (!isEvmChain(chain)) return json({ error: "chain must be an EVM chain" }, 400);
  if (k !== "snipe" && k !== "scalp") return json({ error: "k must be snipe or scalp" }, 400);
  if (await rateLimited(env, request, "evmfeed", 600)) return json({ error: "Too many requests." }, 429);

  const kvKey = `evmfeed:${chain}`;
  try {
    const pages = await Promise.allSettled(evmSourceUrls(chain).map((url) => fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000), cf: { cacheTtl: 45, cacheEverything: true } } as RequestInit).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })));
    const ok = pages.flatMap((p) => (p.status === "fulfilled" ? [p.value] : []));
    if (ok.length === 0) throw new Error("no source answered");
    const rows = normalizeEvmPools(ok, chain);
    const body = { rows: splitEvmTokens(rows)[k], ts: Date.now() };
    if (env.FEEDS) { try { await env.FEEDS.put(kvKey, JSON.stringify(body), { expirationTtl: KV_TTL_S }); } catch { /* best effort */ } }
    return json(body, 200, "public, s-maxage=45, stale-while-revalidate=120");
  } catch {
    if (env.FEEDS) {
      try {
        const cached = await env.FEEDS.get(kvKey);
        if (cached) { const parsed = JSON.parse(cached) as { rows: unknown[]; ts: number }; return json({ rows: parsed.rows, ts: parsed.ts, stale: true }, 200, "public, s-maxage=20"); }
      } catch { /* fall through */ }
    }
    return json({ error: "feed unavailable" }, 503, "no-store");
  }
}
