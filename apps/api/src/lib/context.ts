import type Database from 'better-sqlite3';
import type { Db } from '../db/index.js';
import type { Guards } from './auth.js';
import type { Config } from './config.js';

/** Shared by all route modules. */
export interface AppContext {
  db: Db;
  sqlite: Database.Database;
  config: Config;
  guards: Guards;
}

export const nowIso = () => new Date().toISOString();

/** Converts SQLite 0/1 integers to booleans for the given keys. */
export function bools<T extends object>(row: T, ...keys: (keyof T)[]): T {
  const out = { ...row } as Record<string, unknown>;
  for (const k of keys) out[k as string] = Boolean(row[k]);
  return out as T;
}
