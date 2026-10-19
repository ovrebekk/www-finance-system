import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { msUntilNext, pruneBackups, runBackup } from './backup.js';

describe('backups', () => {
  it('writes a backup and keeps only the newest N', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bk-'));
    for (let i = 1; i <= 4; i++) writeFileSync(join(dir, `finance-2026010${i}-030000.sqlite`), 'x');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1);');
    const file = runBackup(db, dir, 3);
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(3);
    expect(files).toContain(file.split('/').pop());
    expect(new Database(file).prepare('SELECT x FROM t').get()).toEqual({ x: 1 });
    expect(pruneBackups(dir, 1)).toHaveLength(2);
  });

  it('computes time until next 03:00', () => {
    const before = new Date(2026, 9, 19, 2, 0, 0);
    expect(msUntilNext(3, before)).toBe(60 * 60 * 1000);
    const after = new Date(2026, 9, 19, 4, 0, 0);
    expect(msUntilNext(3, after)).toBe(23 * 60 * 60 * 1000);
  });
});
