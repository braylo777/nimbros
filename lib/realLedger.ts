import type { D1 } from "./accountStore.ts";

/* Ledger of real-money trade requests, used for the rolling 24h cap and as an audit trail. */
export interface LedgerRow { id: string; ts: number; agentId: string; address: string; kind: "reserve" | "reported"; usd: number; digest?: string; detail: Record<string, unknown> }

export interface Ledger {
  add(r: LedgerRow): Promise<boolean>; // false if the digest was already recorded
  spentUsd(address: string, since: number): Promise<number>; // sum of 'reserve' rows
  history(address: string, limit: number): Promise<LedgerRow[]>;
  /** platform-wide activity: settled trades only, so nothing counts until it is on chain */
  /** latest settled agent trades platform-wide (no amounts): for the public activity list */
  recent(limit: number): Promise<{ ts: number; digest?: string; side?: unknown }[]>;
  totals(since: number): Promise<{ txns: number; traders: number; volUsd: number }>;
}

export function memoryLedger(): Ledger {
  const rows: LedgerRow[] = [];
  return {
    async add(r) { if (r.digest && rows.some((x) => x.digest === r.digest)) return false; rows.push(r); return true; },
    async spentUsd(a, since) { return rows.filter((r) => r.address === a && r.kind === "reserve" && r.ts >= since).reduce((s, r) => s + r.usd, 0); },
    async history(a, n) { return rows.filter((r) => r.address === a).sort((x, y) => y.ts - x.ts).slice(0, n); },
    async recent(n) { return rows.filter((r) => r.kind === "reported" && r.agentId !== "human").sort((x, y) => y.ts - x.ts).slice(0, n).map((r) => ({ ts: r.ts, digest: r.digest, side: r.detail.side })); },
    async totals(since) {
      const done = rows.filter((r) => r.kind === "reported" && r.agentId !== "human" && r.ts >= since);
      return {
        txns: done.length,
        traders: new Set(done.map((r) => r.address)).size,
        volUsd: done.filter((r) => r.ts >= since).reduce((s, r) => s + r.usd, 0),
      };
    },
  };
}

interface Row { id: string; ts: number; agent_id: string; address: string; kind: string; usd: number; digest: string | null; detail: string }
export function d1Ledger(db: D1): Ledger {
  return {
    async add(r) {
      try {
        await db.prepare("INSERT INTO real_ledger (id, ts, agent_id, address, kind, usd, digest, detail) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")
          .bind(r.id, r.ts, r.agentId, r.address, r.kind, r.usd, r.digest ?? null, JSON.stringify(r.detail)).run();
        return true;
      } catch { return false; }
    },
    async spentUsd(a, since) {
      const r = await db.prepare("SELECT COALESCE(SUM(usd), 0) AS s FROM real_ledger WHERE address = ?1 AND kind = 'reserve' AND ts >= ?2").bind(a, since).first<{ s: number }>();
      return r?.s ?? 0;
    },
    async recent(n) {
      const r = await db.prepare("SELECT ts, digest, detail FROM real_ledger WHERE kind = 'reported' AND agent_id != 'human' ORDER BY ts DESC LIMIT ?1").bind(n).all<{ ts: number; digest: string | null; detail: string }>();
      return r.results.map((x) => { let side: unknown; try { side = (JSON.parse(x.detail) as { side?: unknown }).side; } catch { /* no detail */ } return { ts: x.ts, digest: x.digest ?? undefined, side }; });
    },
    async totals(since) {
      const r = await db.prepare("SELECT COALESCE(SUM(CASE WHEN ts >= ?1 THEN 1 ELSE 0 END), 0) AS n, COUNT(DISTINCT CASE WHEN ts >= ?1 THEN address END) AS t, COALESCE(SUM(CASE WHEN ts >= ?1 THEN usd ELSE 0 END), 0) AS v FROM real_ledger WHERE kind = 'reported' AND agent_id != 'human'").bind(since).first<{ n: number; t: number; v: number }>();
      return { txns: r?.n ?? 0, traders: r?.t ?? 0, volUsd: r?.v ?? 0 };
    },
    async history(a, n) {
      const r = await db.prepare("SELECT id, ts, agent_id, address, kind, usd, digest, detail FROM real_ledger WHERE address = ?1 ORDER BY ts DESC LIMIT ?2").bind(a, n).all<Row>();
      return r.results.map((x) => ({ id: x.id, ts: x.ts, agentId: x.agent_id, address: x.address, kind: x.kind as "reserve" | "reported", usd: x.usd, digest: x.digest ?? undefined, detail: JSON.parse(x.detail) as Record<string, unknown> }));
    },
  };
}
