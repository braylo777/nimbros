import { json } from "../../lib/agentHttp.ts";

/* GET /api/shot?u=<https url> → a small screenshot of that page, for the hover previews on a coin page (the exchange link, the chain link).
   Two public, keyless services, tried in order: Microlink (a real render, best quality, free tier rate-limited — set MICROLINK_KEY to raise it)
   then WordPress's mshots (slower on a page it hasn't seen, but effectively unlimited). The page shown is never fetched by us, only its address
   is passed to these services. Kept at the edge for a week once rendered, so after the first person opens a coin, everyone's preview is instant. */
const ml = (u: string) => {
  const x = /(^|\.)(x|twitter)\.com$/i.test(new URL(u).hostname);
  return `https://api.microlink.io/?${new URLSearchParams({ url: u, screenshot: "true", meta: "false", embed: "screenshot.url", type: "jpeg", "screenshot.quality": "72", "viewport.width": x ? "640" : "1000", "viewport.height": x ? "760" : "620", waitUntil: "load" }).toString()}`;
};
const wpMshots = (u: string) => `https://s0.wp.com/mshots/v1/${encodeURIComponent(u)}?w=520&h=320`;

export async function onRequestGet({ request, env }: { request: Request; env?: { MICROLINK_KEY?: string } }): Promise<Response> {
  const target = new URL(request.url).searchParams.get("u") ?? "";
  try {
    const t = new URL(target);
    const host = t.hostname;
    if (t.protocol !== "https:" || target.length > 300 || !host.includes(".") || /^[\d.]+$/.test(host) || /(^|\.)(localhost|local|internal)$/i.test(host)) throw new Error("no");
  } catch {
    return json({ error: "bad url" }, 400);
  }

  const cache = (globalThis as unknown as { caches?: { default: Cache } }).caches?.default;
  const key = new Request(`https://shot.internal/${encodeURIComponent(target)}`);
  const hit = cache ? await cache.match(key) : undefined;
  if (hit) return hit;

  try {
    const r = await fetch(ml(target), { signal: AbortSignal.timeout(20000), redirect: "follow", headers: env?.MICROLINK_KEY ? { "x-api-key": env.MICROLINK_KEY } : {} });
    const type = r.headers.get("content-type") ?? "";
    if (r.ok && /^image\/(jpeg|png|webp)/.test(type)) {
      const bytes = await r.arrayBuffer();
      if (bytes.byteLength > 2_000 && bytes.byteLength < 1_500_000) {
        const out = new Response(bytes, { headers: { "content-type": type, "cache-control": "public, max-age=86400, s-maxage=604800" } });
        if (cache) await cache.put(key, out.clone());
        return out;
      }
    }
  } catch { /* fall through to the second service */ }

  try {
    const r = await fetch(wpMshots(target), { signal: AbortSignal.timeout(15000), redirect: "follow" });
    const type = r.headers.get("content-type") ?? "";
    if (r.ok && /^image\/(jpeg|png|webp)/.test(type)) {
      const bytes = await r.arrayBuffer();
      const out = new Response(bytes, { headers: { "content-type": type, "cache-control": "public, max-age=3600, s-maxage=86400" } }); // shorter: wp.com may still be rendering a fresh page
      if (cache) await cache.put(key, out.clone());
      return out;
    }
  } catch { /* neither service answered: no picture this time */ }

  return json({ error: "no preview available" }, 503, "no-store");
}
