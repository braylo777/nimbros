import type { D1 } from "../../../lib/accountStore.ts";
import { json } from "../../../lib/agentHttp.ts";

/* POST /api/logo (raw PNG, JPEG or WebP, up to 80 KB) → { url } for use as a coin's logo link at launch.
   Stored in D1 under the hash of its bytes; served back by GET /api/logo/<id>. Ten uploads an hour per address. */
interface Env { DB?: D1 }
const MAX = 80 * 1024;

function kind(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  if (!env.DB) return json({ error: "unavailable" }, 503);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX) return json({ error: "Image must be under 80 KB." }, 413);
  const type = kind(buf);
  if (!type) return json({ error: "Use a PNG, JPEG or WebP image." }, 415);
  const now = Date.now();
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rlKey = `imgrl:${ip}`;
  try {
    const r = await env.DB.prepare("SELECT v, exp FROM blobs WHERE k = ?1").bind(rlKey).first<{ v: string; exp: number }>();
    const n = r && r.exp > now ? Number(r.v) || 0 : 0;
    if (n >= 10) return json({ error: "Too many uploads. Try again in an hour." }, 429);
    await env.DB.prepare("INSERT INTO blobs (k, v, exp) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = ?2, exp = ?3").bind(rlKey, String(n + 1), r && r.exp > now ? r.exp : now + 3_600_000).run();
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
    let bin = "";
    for (const x of buf) bin += String.fromCharCode(x);
    await env.DB.prepare("INSERT INTO blobs (k, v, exp) VALUES (?1, ?2, 0) ON CONFLICT(k) DO NOTHING").bind(`img:${hash}`, `${type};${btoa(bin)}`).run();
    return json({ url: `${new URL(request.url).origin}/api/logo/${hash}` }, 201);
  } catch {
    return json({ error: "Couldn't save the image. Try again." }, 500);
  }
}
