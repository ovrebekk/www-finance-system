import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { hashPassword } from './lib/passwords.js';
import { ConfigError, loadConfig } from './lib/config.js';
import { ADMIN, buildTestApp, client, login } from './test/helpers.js';

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

/** Inserts a transaction with one line directly (transaction API arrives in phase 2). */
function addTransaction(t: {
  type: 'expense' | 'income' | 'transfer';
  amount: number;
  accountId: number;
  toAccountId?: number;
  recipientId?: number;
  categoryId?: number;
  tagIds?: number[];
}) {
  const { lastInsertRowid } = sqlite
    .prepare('INSERT INTO transactions (type, date, amount, account_id, to_account_id, recipient_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(t.type, '2026-10-01', t.amount, t.accountId, t.toAccountId ?? null, t.recipientId ?? null);
  if (t.type !== 'transfer') {
    const line = sqlite
      .prepare('INSERT INTO transaction_lines (transaction_id, category_id, amount) VALUES (?, ?, ?)')
      .run(lastInsertRowid, t.categoryId ?? null, t.amount);
    for (const tagId of t.tagIds ?? []) {
      sqlite.prepare('INSERT INTO transaction_line_tags (line_id, tag_id) VALUES (?, ?)').run(line.lastInsertRowid, tagId);
    }
  }
}

describe('config', () => {
  it('refuses to start in production without a long SESSION_SECRET', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32) })).not.toThrow();
  });
});

describe('health and auth', () => {
  it('health needs no login', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/accounts' });
    expect(res.statusCode).toBe(401);
  });

  it('created the first user as Owner with every permission', async () => {
    const res = await api.get('/api/v1/auth/me');
    expect(res.statusCode).toBe(200);
    const me = res.json();
    expect(me.email).toBe(ADMIN.email);
    expect(me.role).toBe('Owner');
    expect(me.permissions).toContain('settings:admin');
  });

  it('rejects a wrong password and an unknown email the same way', async () => {
    const wrong = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { ...ADMIN, password: 'nope' } });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@example.com', password: 'nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().message).toBe(unknown.json().message);
  });

  it('logs out', async () => {
    const res = await api.post('/api/v1/auth/logout');
    expect(res.statusCode).toBe(204);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('returns 403 when the role lacks the permission', async () => {
    const role = sqlite.prepare("INSERT INTO roles (name, permissions) VALUES ('Reader', ?)").run(JSON.stringify(['accounts:read']));
    sqlite
      .prepare('INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)')
      .run('Reader', 'reader@example.com', await hashPassword('reader password'), role.lastInsertRowid);
    const reader = client(app, await login(app, { email: 'reader@example.com', password: 'reader password' }));
    expect((await reader.get('/api/v1/accounts')).statusCode).toBe(200);
    expect((await reader.post('/api/v1/accounts', { name: 'X', type: 'cash', openingDate: '2026-01-01' })).statusCode).toBe(403);
    expect((await reader.get('/api/v1/tags')).statusCode).toBe(403);
  });

  it('rate-limits login', async () => {
    const limited = await buildTestApp({ LOGIN_RATE_LIMIT: '2' });
    const attempt = () =>
      limited.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { ...ADMIN, password: 'bad' } });
    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(401);
    expect((await attempt()).statusCode).toBe(429);
    await limited.app.close();
  });
});

describe('accounts', () => {
  it('creates, lists, updates and validates', async () => {
    const created = await api.post('/api/v1/accounts', {
      name: 'DNB Brukskonto',
      type: 'checking',
      openingBalance: 100000,
      openingDate: '2026-01-01',
    });
    expect(created.statusCode).toBe(201);
    const account = created.json();
    expect(account).toMatchObject({ name: 'DNB Brukskonto', balance: 100000, archived: false, transactionCount: 0 });

    const dup = await api.post('/api/v1/accounts', { name: 'dnb brukskonto', type: 'cash', openingDate: '2026-01-01' });
    expect(dup.statusCode).toBe(409);

    const bad = await api.post('/api/v1/accounts', { name: '', type: 'checking', openingDate: '1 Jan' });
    expect(bad.statusCode).toBe(400);

    const patched = await api.patch(`/api/v1/accounts/${account.id}`, { archived: true, notes: 'old' });
    expect(patched.json()).toMatchObject({ archived: true, notes: 'old' });

    expect((await api.get('/api/v1/accounts')).json()).toHaveLength(1);
    expect((await api.get('/api/v1/accounts/999')).statusCode).toBe(404);
  });

  it('computes balances including transfers and blocks deleting used accounts', async () => {
    const a = (await api.post('/api/v1/accounts', { name: 'A', type: 'checking', openingBalance: 10000, openingDate: '2026-01-01' })).json();
    const b = (await api.post('/api/v1/accounts', { name: 'B', type: 'savings', openingDate: '2026-01-01' })).json();
    addTransaction({ type: 'income', amount: 5000, accountId: a.id });
    addTransaction({ type: 'expense', amount: 2500, accountId: a.id });
    addTransaction({ type: 'transfer', amount: 3000, accountId: a.id, toAccountId: b.id });

    expect((await api.get(`/api/v1/accounts/${a.id}`)).json().balance).toBe(10000 + 5000 - 2500 - 3000);
    expect((await api.get(`/api/v1/accounts/${b.id}`)).json().balance).toBe(3000);

    const del = await api.del(`/api/v1/accounts/${b.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error).toBe('in_use');

    const c = (await api.post('/api/v1/accounts', { name: 'C', type: 'cash', openingDate: '2026-01-01' })).json();
    expect((await api.del(`/api/v1/accounts/${c.id}`)).statusCode).toBe(204);
  });
});

describe('categories', () => {
  const create = async (name: string, kind: 'expense' | 'income', parentId?: number) =>
    (await api.post('/api/v1/categories', { name, kind, parentId })).json();

  it('builds a tree with kind and cycle checks', async () => {
    const bolig = await create('Bolig', 'expense');
    const strom = await create('Strøm', 'expense', bolig.id);
    const nett = await create('Nettleie', 'expense', strom.id);
    const lonn = await create('Lønn', 'income');

    expect((await api.post('/api/v1/categories', { name: 'X', kind: 'income', parentId: bolig.id })).statusCode).toBe(400);
    expect((await api.patch(`/api/v1/categories/${bolig.id}`, { parentId: nett.id })).statusCode).toBe(400);
    expect((await api.patch(`/api/v1/categories/${bolig.id}`, { parentId: bolig.id })).statusCode).toBe(400);
    expect((await api.patch(`/api/v1/categories/${nett.id}`, { parentId: lonn.id })).statusCode).toBe(400);

    // Same name is allowed under different parents, not among siblings.
    expect((await api.post('/api/v1/categories', { name: 'Annet', kind: 'expense', parentId: bolig.id })).statusCode).toBe(201);
    expect((await api.post('/api/v1/categories', { name: 'Annet', kind: 'expense', parentId: strom.id })).statusCode).toBe(201);
    expect((await api.post('/api/v1/categories', { name: 'annet', kind: 'expense', parentId: strom.id })).statusCode).toBe(409);
    expect((await api.post('/api/v1/categories', { name: 'bolig', kind: 'expense' })).statusCode).toBe(409);

    const moved = await api.patch(`/api/v1/categories/${nett.id}`, { parentId: null });
    expect(moved.json().parentId).toBeNull();
  });

  it('requires a target when deleting a used category and moves lines and children there', async () => {
    const acc = (await api.post('/api/v1/accounts', { name: 'A', type: 'cash', openingDate: '2026-01-01' })).json();
    const mat = await create('Mat', 'expense');
    const dagligvarer = await create('Dagligvarer', 'expense', mat.id);
    const kafe = await create('Kafé', 'expense', mat.id);
    const annet = await create('Annet', 'expense');
    addTransaction({ type: 'expense', amount: 100, accountId: acc.id, categoryId: mat.id });
    addTransaction({ type: 'expense', amount: 200, accountId: acc.id, categoryId: dagligvarer.id });

    const blocked = await api.del(`/api/v1/categories/${mat.id}`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: 'needs_target', details: { usageCount: 1, childCount: 2 } });

    expect((await api.del(`/api/v1/categories/${mat.id}?moveTo=${dagligvarer.id}`)).statusCode).toBe(400);

    expect((await api.del(`/api/v1/categories/${mat.id}?moveTo=${annet.id}`)).statusCode).toBe(204);
    const list = (await api.get('/api/v1/categories')).json() as { id: number; parentId: number | null; usageCount: number }[];
    expect(list.find((c) => c.id === mat.id)).toBeUndefined();
    expect(list.find((c) => c.id === annet.id)?.usageCount).toBe(1);
    expect(list.find((c) => c.id === dagligvarer.id)?.parentId).toBe(annet.id);
    expect(list.find((c) => c.id === kafe.id)?.parentId).toBe(annet.id);

    const unused = await create('Ubrukt', 'expense');
    expect((await api.del(`/api/v1/categories/${unused.id}`)).statusCode).toBe(204);
  });
});

describe('recipients', () => {
  it('blocks deleting a used recipient and merges into another', async () => {
    const acc = (await api.post('/api/v1/accounts', { name: 'A', type: 'cash', openingDate: '2026-01-01' })).json();
    const cat = (await api.post('/api/v1/categories', { name: 'Mat', kind: 'expense' })).json();
    const rema = (await api.post('/api/v1/recipients', { name: 'Rema 1000', defaultCategoryId: cat.id })).json();
    const rema2 = (await api.post('/api/v1/recipients', { name: 'REMA 1000 Majorstuen' })).json();
    expect(rema.defaultCategoryId).toBe(cat.id);
    expect((await api.post('/api/v1/recipients', { name: 'x', defaultCategoryId: 999 })).statusCode).toBe(400);

    addTransaction({ type: 'expense', amount: 4000, accountId: acc.id, recipientId: rema2.id });
    addTransaction({ type: 'expense', amount: 1000, accountId: acc.id, recipientId: rema.id });

    expect((await api.del(`/api/v1/recipients/${rema2.id}`)).statusCode).toBe(409);
    const merged = await api.post(`/api/v1/recipients/${rema2.id}/merge`, { intoId: rema.id });
    expect(merged.json()).toMatchObject({ id: rema.id, transactionCount: 2, total: 5000 });
    expect((await api.get(`/api/v1/recipients/${rema2.id}`)).statusCode).toBe(404);
    expect((await api.post(`/api/v1/recipients/${rema.id}/merge`, { intoId: rema.id })).statusCode).toBe(400);
  });

  it('clears the default category when that category is deleted', async () => {
    const cat = (await api.post('/api/v1/categories', { name: 'Mat', kind: 'expense' })).json();
    const r = (await api.post('/api/v1/recipients', { name: 'Kiwi', defaultCategoryId: cat.id })).json();
    await api.del(`/api/v1/categories/${cat.id}`);
    expect((await api.get(`/api/v1/recipients/${r.id}`)).json().defaultCategoryId).toBeNull();
  });
});

describe('tags', () => {
  it('counts usage, merges without duplicates and deletes', async () => {
    const acc = (await api.post('/api/v1/accounts', { name: 'A', type: 'cash', openingDate: '2026-01-01' })).json();
    const ferie = (await api.post('/api/v1/tags', { name: 'Ferie 2026', color: '#ff8800' })).json();
    const tur = (await api.post('/api/v1/tags', { name: 'Tur' })).json();
    expect(tur.color).toBe('#64748b');
    expect((await api.post('/api/v1/tags', { name: 'Bad', color: 'red' })).statusCode).toBe(400);

    addTransaction({ type: 'expense', amount: 100, accountId: acc.id, tagIds: [ferie.id, tur.id] });
    addTransaction({ type: 'expense', amount: 100, accountId: acc.id, tagIds: [tur.id] });
    expect((await api.get(`/api/v1/tags/${tur.id}`)).json().usageCount).toBe(2);

    const merged = await api.post(`/api/v1/tags/${tur.id}/merge`, { intoId: ferie.id });
    expect(merged.json().usageCount).toBe(2);

    expect((await api.del(`/api/v1/tags/${ferie.id}`)).statusCode).toBe(204);
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM transaction_line_tags').get() as { n: number }).n).toBe(0);
  });
});

describe('settings', () => {
  it('downloads a database backup', async () => {
    const res = await api.get('/api/v1/settings/backup');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="finance-\d{4}-\d{2}-\d{2}\.sqlite"/);
    expect(res.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
  });

  it('lists users with roles', async () => {
    const res = await api.get('/api/v1/users');
    expect(res.json()).toEqual([expect.objectContaining({ email: ADMIN.email, role: 'Owner', active: true })]);
  });
});

describe('web app fallback', () => {
  it('serves index.html for app routes but 404 for missing files', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dist = mkdtempSync(join(tmpdir(), 'web-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Finance</title>');
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'assets', 'app-123.js'), 'console.log(1)');
    const web = await buildTestApp({ WEB_DIST: dist });
    const get = (url: string) => web.app.inject({ method: 'GET', url });
    expect((await get('/categories')).body).toContain('<title>Finance</title>');
    expect((await get('/assets/app-123.js')).headers['cache-control']).toContain('immutable');
    expect((await get('/assets/missing.js')).statusCode).toBe(404);
    expect((await get('/missing.png')).statusCode).toBe(404);
    expect((await get('/api/v1/nope')).statusCode).toBe(404);
    await web.app.close();
  });
});
