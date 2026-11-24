import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { D1 } from "../lib/accountStore.ts";

/* A real SQLite database that speaks the small part of the Cloudflare D1 API the app uses.
   It loads db/schema.sql, so contract tests run against the production schema. */
export function newD1(): D1 {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  const stmt = (q: string, args: unknown[] = []) => ({
    bind: (...v: unknown[]) => stmt(q, v),
    first: async <T>() => ((db.prepare(q).get(...(args as never[])) as T | undefined) ?? null),
    all: async <T>() => ({ results: db.prepare(q).all(...(args as never[])) as T[] }),
    run: async () => ({ meta: { changes: Number(db.prepare(q).run(...(args as never[])).changes) } }),
  });
  return { prepare: (q: string) => stmt(q) } as unknown as D1;
}

export const req = (url: string, init: RequestInit = {}) => new Request("https://nimbros.test" + url, init);
export const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  req(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
