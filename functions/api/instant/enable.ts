import { verifySolMessage } from "../../../lib/solVerify.ts";
import { isSolAddress } from "../../../lib/chain.ts";
import { sha256 } from "../../../lib/agentApi.ts";
import { json } from "../../../lib/agentHttp.ts";
import { enableMessage, enableWindowOk, type InstantSession } from "../../../lib/instant.ts";
import { getAllow, type KV } from "../../../lib/instantHttp.ts";

/* POST /api/instant/enable {agentId, owner, exp, signature}
   The site owner signs `nimbros-instant:<agentId>:<owner>:<exp>` once with their wallet (free, no transaction). If that wallet
   is on the agent's allow list, we hand back a session token (valid until `exp`, at most 24 h) that the site uses to queue
   button clicks for that agent. The token is stored only as a hash. */
export async function onRequestPost({ request, env }: { request: Request; env: { FEEDS?: KV } }): Promise<Response> {
  if (!env.FEEDS) return json({ error: "unavailable" }, 503);
  try {
    const b = (await request.json()) as { agentId?: unknown; owner?: unknown; exp?: unknown; signature?: unknown };
    const now = Date.now();
    const agentId = typeof b.agentId === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(b.agentId) ? b.agentId : "";
    const owner = typeof b.owner === "string" ? b.owner : "";
    if (!agentId || !isSolAddress(owner) || typeof b.signature !== "string" || b.signature.length > 400) return json({ error: "bad request" }, 400);
    if (!enableWindowOk(b.exp, now)) return json({ error: "expiry must be within the next 24 hours" }, 400);

    let signer = "";
    try {
      signer = verifySolMessage(new TextEncoder().encode(enableMessage(agentId, owner, b.exp)), b.signature, owner);
    } catch {
      return json({ error: "bad signature" }, 401);
    }
    if (signer !== owner) return json({ error: "signature doesn't match that wallet" }, 401);
    if (!(await getAllow(env.FEEDS, agentId)).includes(owner)) {
      return json({ error: "That agent hasn't allowed this wallet. On the agent's machine run: nimbros instant allow " + owner }, 403);
    }
    const token = "nbs_" + [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const session: InstantSession = { owner, agentId, exp: b.exp };
    await env.FEEDS.put(`instant:sess:${await sha256(token)}`, JSON.stringify(session), { expirationTtl: Math.max(60, Math.ceil((b.exp - now) / 1000)) });
    return json({ ok: true, token, exp: b.exp });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
