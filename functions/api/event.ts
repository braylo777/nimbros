import { EVENTS } from "../../lib/analytics.ts";
import type { D1 } from "../../lib/accountStore.ts";
import { bump } from "../../lib/counter.ts";

/* POST /api/event {"e":"<known event name>"} — counts one product event.

   Deliberately minimal: only a name from a fixed list is accepted, nothing
   about the visitor is read or stored (no IP, no user agent, no wallet), and
   the counter key is the event plus the UTC date. Unknown names are dropped. */

interface Env { DB?: D1 }
const TTL_MS = 90 * 24 * 3600 * 1000;

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  const ok = new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  try {
    const body = (await request.json()) as { e?: unknown };
    const name = typeof body.e === "string" ? body.e : "";
    if (!(EVENTS as readonly string[]).includes(name)) return ok; // drop quietly; never echo input back
    if (!env.DB) return ok;
    await bump(env.DB, `ev:${new Date().toISOString().slice(0, 10)}:${name}`, TTL_MS);
  } catch {
    /* metrics must never affect the app */
  }
  return ok;
}
