import type { D1 } from "../../../lib/accountStore.ts";

interface Env { DB?: D1 }

/* GET /api/logo/<id> → the uploaded image. Content never changes for a given id, so it is cached for a year. */
export async function onRequestGet({ params, env }: { params: { id?: string }; env: Env }): Promise<Response> {
  const id = String(params.id ?? "");
  if (!env.DB || !/^[0-9a-f]{24}$/.test(id)) return new Response("not found", { status: 404 });
  const r = await env.DB.prepare("SELECT v FROM blobs WHERE k = ?1").bind(`img:${id}`).first<{ v: string }>();
  const m = r && /^(image\/(?:png|jpeg|webp));(.+)$/.exec(r.v);
  if (!m) return new Response("not found", { status: 404 });
  const bin = atob(m[2]);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { "content-type": m[1], "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
}
