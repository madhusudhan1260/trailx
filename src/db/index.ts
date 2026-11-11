import * as SQLite from 'expo-sqlite';
import { migrate, type Db } from './schema';

let instance: Promise<Db> | null = null;

function wrap(db: SQLite.SQLiteDatabase): Db {
  let depth = 0;
  let chain: Promise<unknown> = Promise.resolve();
  const bind = (p: unknown[] = []) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)) as SQLite.SQLiteBindValue[];
  const api: Db = {
    exec: (sql) => db.execAsync(sql),
    async run(sql, params) {
      const r = await db.runAsync(sql, bind(params));
      return { lastId: r.lastInsertRowId, changes: r.changes };
    },
    all: <T,>(sql: string, params?: unknown[]) => db.getAllAsync<T>(sql, bind(params)),
    first: <T,>(sql: string, params?: unknown[]) => db.getFirstAsync<T>(sql, bind(params)),
    tx<T>(fn: () => Promise<T>): Promise<T> {
      if (depth > 0) return fn();
      // Transactions are queued one after another on the single connection.
      const run = chain.then(async () => {
        depth++;
        await db.execAsync('BEGIN IMMEDIATE');
        try {
          const out = await fn();
          await db.execAsync('COMMIT');
          return out;
        } catch (e) {
          await db.execAsync('ROLLBACK');
          throw e;
        } finally {
          depth--;
        }
      });
      chain = run.catch(() => undefined);
      return run;
    },
  };
  return api;
}

/** Opens (once) and migrates the on-device database. Shared by the UI and the background location task. */
export function getDb(): Promise<Db> {
  if (!instance) {
    instance = (async () => {
      const raw = await SQLite.openDatabaseAsync('trailx.db');
      const db = wrap(raw);
      await migrate(db);
      return db;
    })();
    instance.catch(() => (instance = null));
  }
  return instance;
}
