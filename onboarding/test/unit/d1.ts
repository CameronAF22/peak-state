// A D1-shaped database on node:sqlite for the API tests, with the real migration applied.

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Database, Statement } from "../../worker/api.ts";

export function fakeD1(): Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8"));
  const statement = (sql: string, values: unknown[] = []): Statement => ({
    bind: (...v: unknown[]) => statement(sql, v),
    first: async <T>() => (db.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
    run: async () => {
      const r = db.prepare(sql).run(...(values as never[]));
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}
