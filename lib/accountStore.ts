/* Where agent accounts live. Every save is checked against a version number, so two requests that
   read the same account at once can't both write: the second one is refused and retries on fresh data. */

export interface Stored { id: string; name: string; version: number; active: boolean }

export interface Store<A extends Stored> {
  /** false if the name or key is already taken */
  create(a: A, keyHash: string): Promise<boolean>;
  get(id: string): Promise<A | null>;
  byKeyHash(h: string): Promise<A | null>;
  list(): Promise<A[]>;
  listActive(): Promise<A[]>;
  count(): Promise<number>;
  /** writes only if the stored version still equals a.version; bumps it. false = someone else wrote first */
  save(a: A): Promise<boolean>;
}

/* ---- in-memory (tests and local use) ---- */
export function memoryStore<A extends Stored>(): Store<A> {
  const rows = new Map<string, { a: string; keyHash: string; version: number }>();
  const parse = (r: { a: string; version: number }) => ({ ...(JSON.parse(r.a) as A), version: r.version });
  return {
    async create(a, keyHash) {
      for (const r of rows.values()) if (r.keyHash === keyHash || (JSON.parse(r.a) as A).name.toLowerCase() === a.name.toLowerCase()) return false;
      if (rows.has(a.id)) return false;
      rows.set(a.id, { a: JSON.stringify(a), keyHash, version: 0 });
      return true;
    },
    async get(id) { const r = rows.get(id); return r ? parse(r) : null; },
    async byKeyHash(h) { for (const r of rows.values()) if (r.keyHash === h) return parse(r); return null; },
    async list() { return [...rows.values()].map(parse); },
    async listActive() { return [...rows.values()].map(parse).filter((a) => a.active); },
    async count() { return rows.size; },
    async save(a) {
      const r = rows.get(a.id);
      if (!r || r.version !== a.version) return false;
      rows.set(a.id, { ...r, a: JSON.stringify(a), version: r.version + 1 });
      return true;
    },
  };
}

/* ---- Cloudflare D1 ---- */
interface D1Stmt { bind(...v: unknown[]): D1Stmt; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes?: number } }> }
export interface D1 { prepare(q: string): D1Stmt }
interface Row { data: string; version: number }

export function d1Store<A extends Stored>(db: D1): Store<A> {
  const parse = (r: Row) => ({ ...(JSON.parse(r.data) as A), version: r.version });
  return {
    async create(a, keyHash) {
      try {
        await db.prepare("INSERT INTO agents (id, name_lc, key_hash, version, active, data) VALUES (?1, ?2, ?3, 0, ?4, ?5)")
          .bind(a.id, a.name.toLowerCase(), keyHash, a.active ? 1 : 0, JSON.stringify(a)).run();
        return true;
      } catch { return false; } // UNIQUE violation: name, key or id already exists
    },
    async get(id) { const r = await db.prepare("SELECT data, version FROM agents WHERE id = ?1").bind(id).first<Row>(); return r ? parse(r) : null; },
    async byKeyHash(h) { const r = await db.prepare("SELECT data, version FROM agents WHERE key_hash = ?1").bind(h).first<Row>(); return r ? parse(r) : null; },
    async list() { return (await db.prepare("SELECT data, version FROM agents").all<Row>()).results.map(parse); },
    async listActive() { return (await db.prepare("SELECT data, version FROM agents WHERE active = 1").all<Row>()).results.map(parse); },
    async count() { return (await db.prepare("SELECT COUNT(*) AS n FROM agents").first<{ n: number }>())?.n ?? 0; },
    async save(a) {
      const r = await db.prepare("UPDATE agents SET data = ?1, version = version + 1, active = ?2 WHERE id = ?3 AND version = ?4")
        .bind(JSON.stringify(a), a.active ? 1 : 0, a.id, a.version).run();
      return r.meta.changes === 1;
    },
  };
}
