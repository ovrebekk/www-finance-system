import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { LegacyImportReport, Transaction } from '@finance/shared';
import { parseCsv } from './lib/legacyImport.js';
import { buildTestApp, client, login } from './test/helpers.js';

let app: FastifyInstance;
let sqlite: Database.Database;
let api: ReturnType<typeof client>;

beforeEach(async () => {
  const built = await buildTestApp();
  app = built.app;
  sqlite = built.ctx.sqlite;
  api = client(app, await login(app));
});

afterEach(async () => {
  await app.close();
});

const csv = (...lines: string[]) => lines.join('\r\n') + '\r\n';

/** A small export in the format CsvExporter.cs writes (format version 1). */
const exportFiles = (over: Record<string, string> = {}) => ({
  'export-summary.txt': 'PersonalFinanceWPF CSV export\r\nFormat version: 1\r\nExported: 2026-10-23 00:22:01\r\n\r\nWarnings (2):\r\n- a\r\n- b\r\n',
  'accounts.csv': csv(
    'legacy_id,name,type,opening_balance,opening_date,archived,sort_order,notes,legacy_type,legacy_balance,legacy_balance_date',
    '1,Visa SBanken,checking,0,2020-01-02,false,0,,1,134161,2020-01-01',
    '7,Nordea,checking,0,2020-05-22,false,1,Mortgage account,1,0,2021-02-07',
  ),
  'categories.csv': csv(
    'legacy_id,name,kind,parent_legacy_id,archived,sort_order,path',
    '30,Cafe,expense,7,false,0,Eating out > Cafe',
    '7,Eating out,expense,,false,0,Eating out',
    '9,Food,expense,,false,0,Food',
    '22,Salary,income,,false,0,Salary',
  ),
  'recipients.csv': csv(
    'legacy_id,name,default_category_legacy_id,notes,archived,legacy_branch,legacy_type',
    '400000000,Rema,9,,false,Torshov,Grocery Store',
    '400000001,rema,9,,false,Sandvika,Grocery Store',
    '400000072,Espresso House,30,,false,,Cafe',
  ),
  'tags.csv': csv('legacy_id,name,color,legacy_parent_id,legacy_note', '1,Travel,#3ddb68,,Trips', '2,Tools,,1,'),
  'transactions.csv': csv(
    'legacy_id,type,date,amount,account_legacy_id,to_account_legacy_id,recipient_legacy_id,description,status',
    '50,expense,2020-01-02,9700,1,,400000001,"Kaffe, ""stor""\nog bolle",cleared',
    '51,expense,2020-01-03,30000,1,,400000000,Weekly shop,cleared',
    '60,income,2020-01-25,5000000,7,,,,cleared',
    '70+71,transfer,2020-01-26,100000,7,1,,Påfyll,cleared',
  ),
  'transaction_lines.csv': csv(
    'transaction_legacy_id,line_no,category_legacy_id,amount,memo',
    '50,1,30,9700,',
    '51,2,30,5000,Coffee',
    '51,1,9,25000,',
    '60,1,22,5000000,',
  ),
  'transaction_line_tags.csv': csv('transaction_legacy_id,line_no,tag_legacy_id', '51,2,1'),
  ...over,
});

const runImport = (files: Record<string, string>, dryRun = false) => api.post('/api/v1/import/legacy', { files, dryRun });
const count = (table: string) => (sqlite.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number);

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded commas and newlines, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b,c\r\n1,"x, ""y""\r\nz",\r\n2,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, "y"\r\nz', ''],
      ['2', '', '3'],
    ]);
  });
});

describe('legacy import', () => {
  it('imports every file, merging same-name recipients and mapping legacy ids', async () => {
    const res = await runImport(exportFiles());
    expect(res.statusCode).toBe(200);
    const report = res.json() as LegacyImportReport;
    expect(report).toMatchObject({ dryRun: false, formatVersion: 1, exportedAt: '2026-10-23 00:22:01', exportWarnings: 2 });
    expect(report.counts).toEqual({
      accounts: { rows: 2, created: 2, merged: 0, skipped: 0 },
      categories: { rows: 4, created: 4, merged: 0, skipped: 0 },
      recipients: { rows: 3, created: 2, merged: 1, skipped: 0 },
      tags: { rows: 2, created: 2, merged: 0, skipped: 0 },
      transactions: { rows: 4, created: 4, merged: 0, skipped: 0 },
      lines: { rows: 4, created: 4, merged: 0, skipped: 0 },
      lineTags: { rows: 1, created: 1, merged: 0, skipped: 0 },
    });
    expect(report.notes).toContain("2 old recipients named 'Rema' were merged into one.");
    expect(report.notes.some((n) => n.includes('parent tag'))).toBe(true);

    const accounts = (await api.get('/api/v1/accounts')).json() as { name: string; balance: number; notes: string | null }[];
    expect(accounts.find((a) => a.name === 'Visa SBanken')?.balance).toBe(-9700 - 30000 + 100000);
    expect(accounts.find((a) => a.name === 'Nordea')).toMatchObject({ balance: 5000000 - 100000, notes: 'Mortgage account' });

    const cafe = sqlite.prepare("SELECT id, parent_id AS parentId FROM categories WHERE name = 'Cafe'").get() as { id: number; parentId: number };
    expect(sqlite.prepare('SELECT legacy_id FROM categories WHERE id = ?').pluck().get(cafe.parentId)).toBe('7');

    const { items } = (await api.get('/api/v1/transactions?limit=10')).json() as { items: Transaction[] };
    const byDescription = (d: string) => items.find((t) => t.description === d)!;
    expect(items.find((t) => t.description?.startsWith('Kaffe'))!.description).toBe('Kaffe, "stor"\nog bolle');
    const shop = byDescription('Weekly shop');
    expect(shop.lines.map((l) => [l.amount, l.memo, l.tagIds.length])).toEqual([
      [25000, null, 0],
      [5000, 'Coffee', 1],
    ]);
    const transfer = byDescription('Påfyll');
    expect(transfer).toMatchObject({ type: 'transfer', amount: 100000, lines: [] });
    expect(sqlite.prepare('SELECT legacy_id FROM transactions WHERE id = ?').pluck().get(transfer.id)).toBe('70+71');

    const rema = sqlite.prepare("SELECT created_by FROM recipients WHERE name = 'Rema'").pluck().get();
    expect(rema).toBe(sqlite.prepare('SELECT id FROM users').pluck().get());
    expect(sqlite.prepare("SELECT color FROM tags WHERE name = 'Tools'").pluck().get()).toBe('#64748b');
  });

  it('writes nothing on a dry run', async () => {
    const res = await runImport(exportFiles(), true);
    expect(res.statusCode).toBe(200);
    expect(res.json().counts.transactions.created).toBe(4);
    expect(count('transactions') + count('accounts') + count('recipients') + count('categories')).toBe(0);
  });

  it('skips everything on a second run', async () => {
    await runImport(exportFiles());
    const report = (await runImport(exportFiles())).json() as LegacyImportReport;
    for (const c of Object.values(report.counts)) expect(c.created).toBe(0);
    expect(report.counts.recipients).toMatchObject({ merged: 0, skipped: 3 });
    expect(report.counts.transactions.skipped).toBe(4);
    expect(report.notes.filter((n) => n.includes('merged'))).toEqual([]);
    expect(count('transactions')).toBe(4);
  });

  it('merges into rows that already exist here', async () => {
    await api.post('/api/v1/recipients', { name: 'REMA' });
    await api.post('/api/v1/accounts', { name: 'nordea', type: 'savings', openingDate: '2019-01-01' });
    const report = (await runImport(exportFiles())).json() as LegacyImportReport;
    expect(report.counts.recipients).toMatchObject({ created: 1, merged: 2 });
    expect(report.counts.accounts).toMatchObject({ created: 1, merged: 1 });
    expect(report.notes).toContain("2 old recipients named 'REMA' merged into the existing recipient.");
    expect(count('recipients')).toBe(2);
  });

  it('rolls back everything when a row is invalid', async () => {
    const files = exportFiles({
      'transaction_lines.csv': csv('transaction_legacy_id,line_no,category_legacy_id,amount,memo', '50,1,30,9700,', '51,1,9,25000,', '60,1,22,5000000,'),
    });
    const res = await runImport(files);
    expect(res.statusCode).toBe(400);
    expect(res.json().details).toContain('transactions.csv row 3 (legacy id 51): amount 30000 is not the sum of its lines (25000)');
    expect(count('accounts')).toBe(0);
  });

  it('reports wrong category kinds and unknown references', async () => {
    const files = exportFiles({
      'transaction_lines.csv': csv(
        'transaction_legacy_id,line_no,category_legacy_id,amount,memo',
        '50,1,22,9700,',
        '51,1,9,30000,',
        '60,1,22,5000000,',
        '99,1,9,100,',
      ),
    });
    const details = (await runImport(files)).json().details as string[];
    expect(details).toEqual([
      'transaction_lines.csv row 5: transaction_legacy_id 99 is not in transactions.csv',
      'transaction_lines.csv row 2: income category on expense transaction 50',
      'transaction_line_tags.csv row 2: no line 2 on transaction 51',
    ]);
  });

  it('refuses unknown format versions and incomplete folders', async () => {
    const v2 = await runImport(exportFiles({ 'export-summary.txt': 'Format version: 2\r\n' }));
    expect(v2.statusCode).toBe(400);
    expect(v2.json().message).toMatch(/version 2 is not supported/);

    const { 'transactions.csv': _, ...rest } = exportFiles();
    const missing = await runImport(rest);
    expect(missing.statusCode).toBe(400);
    expect(missing.json().details).toEqual(['transactions.csv is missing']);
  });

  it('needs a signed-in user', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/import/legacy', payload: { files: exportFiles() } });
    expect(res.statusCode).toBe(401);
  });
});
