import { verifySolMessage } from "./solVerify.ts";
import { isSolAddress } from "./chain.ts";
import type { Store, Stored } from "./accountStore.ts";
import type { Ledger } from "./realLedger.ts";
import { alertHit, makeAlert, type Alert } from "./alerts.ts";
import type { Market } from "./serverMarket.ts";
import { normType } from "./tradingview.ts";
import { checkWebhookUrl, deliver, type AgentEvent } from "./webhook.ts";

/* Agent accounts. There is no virtual money here: an agent registers, proves it controls a wallet,
   and from then on every trade it makes is a real signed swap (see realTrade.ts). This module owns
   identity, the wallet link, price alerts and webhook delivery — nothing that moves funds.
   Only this module changes an account, and every write is version-checked (see accountStore.ts),
   so simultaneous requests can't overwrite each other. Dependencies are passed in for testing. */

export interface Account extends Stored {
  created: number;
  alerts: Alert[];
  /** Solana address the agent proved it controls (signed `nimbros-link:<agent id>`); needed for real trading */
  wallet?: string;
  webhook?: { url: string; secret: string };
  outbox: AgentEvent[];
}
export interface Deps {
  store: Store<Account>;
  now: () => number;
  rand: () => string; // 32 hex chars
  lookup: (coin: string) => Promise<Market | null>;
  marks: (coins: string[]) => Promise<Map<string, number>>;
  /** what one SOL is worth in USD right now; null when it can't be read */
  solUsd: () => Promise<number | null>;
}

const MAX_AGENTS = 300;
const MAX_OUTBOX = 50;
const RETRIES = 5;

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Err = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Err => ({ ok: false, status, error });
const isErr = (x: unknown): x is Err => typeof x === "object" && x !== null && (x as Err).ok === false;

const activeOf = (a: Account): boolean => a.alerts.length > 0 || a.outbox.length > 0;
const touch = (a: Account): Account => ({ ...a, active: activeOf(a) });

function emit(a: Account, type: string, data: Record<string, unknown>, d: Deps): Account {
  if (!a.webhook) return a; // events only queue for agents that have a webhook
  const e: AgentEvent = { id: d.rand().slice(0, 12), t: d.now(), type, data };
  return { ...a, outbox: [...a.outbox, e].slice(-MAX_OUTBOX) };
}

/** Read-modify-write with retries: `fn` sees fresh data each time and either returns the new account or an error. */
async function mutate<R>(d: Deps, id: string, fn: (a: Account) => { acct: Account; result: R } | Err): Promise<{ ok: true; result: R } | Err> {
  for (let i = 0; i < RETRIES; i++) {
    const cur = await d.store.get(id);
    if (!cur) return fail(404, "unknown agent");
    const out = fn(cur);
    if (isErr(out)) return out;
    if (await d.store.save(touch(out.acct))) return { ok: true, result: out.result };
  }
  return fail(409, "busy, try again");
}

/* ---------------- registration and auth ---------------- */
export async function register(d: Deps, name: unknown): Promise<{ ok: true; id: string; apiKey: string } | Err> {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{1,23}$/.test(name.trim())) return fail(400, "name: 2-24 characters, letters, numbers, space _ . -");
  if ((await d.store.count()) >= MAX_AGENTS) return fail(503, "registrations are full for now");
  const id = d.rand().slice(0, 10);
  const apiKey = `nbk_${d.rand()}`;
  const acct: Account = { id, name: name.trim(), created: d.now(), version: 0, active: false, alerts: [], outbox: [] };
  if (!(await d.store.create(acct, await sha256(apiKey)))) return fail(409, "that name is taken");
  return { ok: true, id, apiKey };
}

export async function authenticate(d: Deps, header: string | null): Promise<Account | Err> {
  const m = /^Bearer (nbk_[0-9a-f]{32})$/.exec(header ?? "");
  if (!m) return fail(401, "send Authorization: Bearer <api key>");
  return (await d.store.byKeyHash(await sha256(m[1]))) ?? fail(401, "unknown api key");
}

export interface PlatformStats { activeAgents: number; agentTxns: number; vol24hUsd: number }

/** Homepage activity numbers, read from the real ledger: settled on-chain trades only, so nothing
    is counted until it actually happened. */
export async function platformStats(ledger: Ledger, now: number): Promise<PlatformStats> {
  const t = await ledger.totals(now - 86_400_000);
  return { activeAgents: t.traders, agentTxns: t.txns, vol24hUsd: t.volUsd };
}

/* ---------------- account actions: alerts, webhooks and the wallet link ---------------- */
export type Op = Record<string, unknown> & { op?: unknown };

export async function act(d: Deps, acct: Account, req: Op): Promise<{ ok: true; [k: string]: unknown } | Err> {
  const op = req.op;
  const now = d.now();
  const wrap = <R>(x: { ok: true; result: R } | Err) => (x.ok ? ({ ok: true as const, ...(x.result as object) }) : x);

  if (op === "cancel") {
    const id = String(req.id ?? "");
    return wrap(await mutate(d, acct.id, (a) => {
      const has = a.alerts.some((x) => x.id === id);
      return has ? { acct: { ...a, alerts: a.alerts.filter((x) => x.id !== id) }, result: { cancelled: id } } : fail(404, "no alert with that id");
    }));
  }
  if (op === "alert") {
    return wrap(await mutate(d, acct.id, (a) => {
      const al = makeAlert(req, d.rand().slice(0, 8), now, a.alerts.length);
      return al.ok ? { acct: { ...a, alerts: [...a.alerts, al.value] }, result: { alert: al.value } } : fail(422, al.message);
    }));
  }
  if (op === "webhook") {
    if (req.url === null) return wrap(await mutate(d, acct.id, (a) => ({ acct: { ...a, webhook: undefined, outbox: [] }, result: { webhook: null } })));
    const u = checkWebhookUrl(req.url);
    if (!u.ok) return fail(422, u.message);
    const secret = `nbsec_${d.rand()}`;
    const out = wrap(await mutate(d, acct.id, (a) => ({ acct: { ...a, webhook: { url: u.url, secret } }, result: { webhook: u.url, secret } })));
    return out; // the signing secret is shown only here
  }
  if (op === "link_wallet") {
    const sig = req.signature;
    if (typeof sig !== "string" || sig.length > 400) return fail(400, "signature is required");
    // a Solana address IS the public key, so the signature can only be checked against the address it claims to be from
    if (!isSolAddress(req.address)) return fail(400, "address is required: the Solana wallet that made the signature");
    let address: string;
    try {
      address = verifySolMessage(new TextEncoder().encode(`nimbros-link:${acct.id}`), sig, req.address);
    } catch { return fail(422, "that signature is not valid"); }
    const all = await d.store.list();
    if (all.some((x) => x.id !== acct.id && x.wallet === address)) return fail(409, "that wallet is linked to another agent");
    return wrap(await mutate(d, acct.id, (a) => ({ acct: { ...a, wallet: address }, result: { wallet: address } })));
  }
  if (op === "unlink_wallet") return wrap(await mutate(d, acct.id, (a) => ({ acct: { ...a, wallet: undefined }, result: { wallet: null } })));
  return fail(400, "op must be one of: cancel, alert, webhook, link_wallet, unlink_wallet");
}

/* ---------------- the scheduler: price alerts, then webhook delivery ---------------- */
export interface TickReport { accounts: number; alerts: number; delivered: number }

export async function tick(d: Deps): Promise<TickReport> {
  const report: TickReport = { accounts: 0, alerts: 0, delivered: 0 };
  const active = await d.store.listActive();
  report.accounts = active.length;
  if (active.length === 0) return report;

  const byNorm = await d.marks(active.flatMap((a) => a.alerts.map((x) => x.coin)));
  const price = (c: string) => byNorm.get(normType(c)); // alert triggers are in dollars, as shown in the lists

  for (const a0 of active) {
    if (a0.alerts.length === 0) continue;
    let fired = 0;
    const res = await mutate(d, a0.id, (cur) => {
      let a = cur;
      fired = 0;
      const left: Alert[] = [];
      for (const al of a.alerts) {
        const p = price(al.coin);
        if (p !== undefined && alertHit(al, p)) { a = emit(a, "alert", { id: al.id, coin: al.coin, dir: al.dir, price: al.price, mark: p }, d); fired++; }
        else left.push(al);
      }
      return { acct: { ...a, alerts: left }, result: null };
    });
    if (res.ok) report.alerts += fired;
  }

  // webhooks: send queued events, keep only the ones that failed
  for (const a of await d.store.listActive()) {
    if (!a.webhook || a.outbox.length === 0) continue;
    const sent = a.outbox;
    const left = await deliver(a.webhook.url, a.webhook.secret, sent);
    const doneIds = new Set(sent.map((e) => e.id));
    left.forEach((e) => doneIds.delete(e.id));
    const retry = new Map(left.map((e) => [e.id, e]));
    await mutate(d, a.id, (cur) => ({ acct: { ...cur, outbox: cur.outbox.filter((e) => !doneIds.has(e.id)).map((e) => retry.get(e.id) ?? e) }, result: null }));
    report.delivered += doneIds.size;
  }
  return report;
}

