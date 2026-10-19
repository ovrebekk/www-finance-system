import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface Database_ {
  sqlite: Database.Database;
  db: Db;
}

/** Folder with the generated SQL migrations (apps/api/drizzle). */
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Opens (or creates) the SQLite file, applies pragmas and runs pending migrations. */
export function openDatabase(file: string): Database_ {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { sqlite, db };
}

export { schema };
