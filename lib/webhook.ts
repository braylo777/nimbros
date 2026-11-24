/* Outgoing webhooks for agents: their own https endpoint gets a signed JSON event when an order
   fills, a perp is liquidated, or an alert fires. */

export interface AgentEvent { id: string; t: number; type: string; data: Record<string, unknown>; tries?: number }

/** Only public https URLs. (Cloudflare Workers can't reach private networks anyway; this also
    stops obvious mistakes and credentials-in-URL.) */
export function checkWebhookUrl(raw: unknown): { ok: true; url: string } | { ok: false; message: string } {
  if (typeof raw !== "string" || raw.length > 300) return { ok: false, message: "url must be an https link, 300 characters or fewer." };
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, message: "That isn't a valid URL." }; }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== "https:") return { ok: false, message: "Webhooks must use https." };
  if (u.username || u.password) return { ok: false, message: "Don't put credentials in the URL." };
  if (u.port && u.port !== "443") return { ok: false, message: "Use the default https port." };
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") || /^[\d.]+$/.test(h) || h.startsWith("[")) return { ok: false, message: "Use a public hostname, not an IP address or a local name." };
  return { ok: true, url: u.toString() };
}

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const MAX_TRIES = 5;
/** Sends the events in order; returns the ones that still need another attempt. Never throws. */
export async function deliver(url: string, secret: string, events: AgentEvent[], f: typeof fetch = fetch): Promise<AgentEvent[]> {
  const left: AgentEvent[] = [];
  for (const e of events) {
    const body = JSON.stringify({ id: e.id, t: e.t, type: e.type, data: e.data });
    try {
      const r = await f(url, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(4000),
        headers: { "content-type": "application/json", "x-nimbros-signature": `sha256=${await hmacHex(secret, body)}`, "x-nimbros-event": e.type },
        body,
      });
      if (r.status >= 200 && r.status < 300) continue;
    } catch { /* falls through to retry */ }
    const tries = (e.tries ?? 0) + 1;
    if (tries < MAX_TRIES) left.push({ ...e, tries });
  }
  return left;
}
