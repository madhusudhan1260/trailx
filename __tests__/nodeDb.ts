import { DatabaseSync } from 'node:sqlite';
import type { Db } from '@/db/schema';

/** Real SQLite (Node's built-in) behind the app's Db interface. Pass a file path to test restarts. */
export function openNodeDb(path = ':memory:'): Db & { close(): void } {
  const db = new DatabaseSync(path);
  const bind = (p: unknown[] = []) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)) as any[];
  let depth = 0;
  return {
    async exec(sql) { db.exec(sql); },
    async run(sql, params) {
      const r = db.prepare(sql).run(...bind(params));
      return { lastId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    async all<T>(sql: string, params?: unknown[]) { return db.prepare(sql).all(...bind(params)) as T[]; },
    async first<T>(sql: string, params?: unknown[]) { return (db.prepare(sql).get(...bind(params)) as T) ?? null; },
    async tx(fn) {
      if (depth > 0) return fn();
      depth++;
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn();
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
    close() { db.close(); },
  };
}
