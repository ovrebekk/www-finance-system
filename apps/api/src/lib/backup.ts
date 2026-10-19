import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const PREFIX = 'finance-';

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Writes a consistent copy of the database with VACUUM INTO (safe while running). */
export function writeBackup(sqlite: Database.Database, file: string): string {
  sqlite.prepare('VACUUM INTO ?').run(file);
  return file;
}

/** Nightly backup into `dir`, keeping the newest `keep` files. */
export function runBackup(sqlite: Database.Database, dir: string, keep: number): string {
  mkdirSync(dir, { recursive: true });
  let file = join(dir, `${PREFIX}${stamp()}.sqlite`);
  let n = 1;
  while (existsSync(file)) file = join(dir, `${PREFIX}${stamp()}-${n++}.sqlite`);
  writeBackup(sqlite, file);
  pruneBackups(dir, keep);
  return file;
}

export function pruneBackups(dir: string, keep: number): string[] {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.sqlite'))
    .sort()
    .reverse();
  const removed = files.slice(keep);
  for (const f of removed) rmSync(join(dir, f), { force: true });
  return removed;
}

/** Milliseconds from `now` until the next occurrence of `hour`:00 local time. */
export function msUntilNext(hour: number, now = new Date()): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/** Runs `task` every day at `hour`:00 local time. Returns a stop function. */
export function scheduleDaily(hour: number, task: () => void): () => void {
  let timer: NodeJS.Timeout;
  const arm = () => {
    timer = setTimeout(() => {
      try {
        task();
      } finally {
        arm();
      }
    }, msUntilNext(hour));
    timer.unref();
  };
  arm();
  return () => clearTimeout(timer);
}
