import { json } from "../../lib/agentHttp.ts";

/* GET /api/frameable?u=<https url> → { ok: boolean }  Whether a site allows itself to be shown inside another page (an iframe). Sites that
   forbid it (X, Discord, Telegram, most banks) send X-Frame-Options or a CSP frame-ancestors rule. Read once from the site's own headers,
   cached for a day, so the hover preview knows whether to try the live page or fall back to a screenshot. */
export async function onRequestGet({ request }: { request: Request }): Promise<Response> {
  const u = new URL(request.url).searchParams.get("u") ?? "";
  let host = "";
  try {
    const t = new URL(u);
    host = t.hostname;
    if (t.protocol !== "https:" || u.length > 300 || !host.includes(".") || /^[\d.]+$/.test(host) || /(^|\.)(localhost|local|internal)$/i.test(host)) throw new Error("no");
  } catch {
    return json({ error: "bad url" }, 400);
  }
  try {
    const r = await fetch(u, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "user-agent": "Mozilla/5.0 (compatible; NimBrosFrameCheck)" }, cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit);
    const xfo = (r.headers.get("x-frame-options") ?? "").toLowerCase();
    const csp = r.headers.get("content-security-policy") ?? "";
    const fa = /frame-ancestors([^;]*)/i.exec(csp)?.[1]?.trim() ?? "";
    const blockedByXfo = xfo.includes("deny") || xfo.includes("sameorigin");
    const blockedByCsp = fa !== "" && !/(^|\s)(\*|https:)(\s|$)/.test(fa);
    return json({ ok: r.ok && !blockedByXfo && !blockedByCsp }, 200, "public, s-maxage=86400, stale-while-revalidate=604800");
  } catch {
    return json({ ok: false }, 200, "public, s-maxage=600");
  }
}
