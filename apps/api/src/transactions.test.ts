import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Transaction, TransactionPage } from '@finance/shared';
import { hashPassword } from './lib/passwords.js';
import { addMonths } from './routes/dashboard.js';
import { buildTestApp, client, login } from './test/helpers.js';

let app: FastifyInstance;
let sqlite: Database.Database;
let api: ReturnType<typeof client>;
let ids: { checking: number; savings: number; food: number; groceries: number; cafe: number; salary: number; kiwi: number; trip: number };

beforeEach(async () => {
  const built = await buildTestApp();
  app = built.app;
  sqlite = built.ctx.sqlite;
  api = client(app, await login(app));
  const post = async (url: string, body: unknown) => (await api.post(url, body)).json().id as number;
  const food = await post('/api/v1/categories', { name: 'Mat', kind: 'expense' });
  ids = {
    checking: await post('/api/v1/accounts', { name: 'Brukskonto', type: 'checking', openingBalance: 100000, openingDate: '2026-01-01' }),
    savings: await post('/api/v1/accounts', { name: 'Sparekonto', type: 'savings', openingDate: '2026-01-01' }),
    food,
    groceries: await post('/api/v1/categories', { name: 'Dagligvarer', kind: 'expense', parentId: food }),
    cafe: await post('/api/v1/categories', { name: 'Kafé', kind: 'expense' }),
    salary: await post('/api/v1/categories', { name: 'Lønn', kind: 'income' }),
    kiwi: await post('/api/v1/recipients', { name: 'Kiwi' }),
    trip: await post('/api/v1/tags', { name: 'Tur' }),
  };
});

afterEach(async () => {
  await app.close();
});

const expense = (over: Record<string, unknown> = {}) => ({
  type: 'expense',
  date: '2026-10-05',
  accountId: ids.checking,
  recipientId: ids.kiwi,
  lines: [{ categoryId: ids.groceries, amount: 25000 }],
  ...over,
});

const list = async (query = '') => (await api.get(`/api/v1/transactions${query}`)).json() as TransactionPage;

describe('transactions', () => {
  it('creates a split expense, updates balances and reads it back', async () => {
    const res = await api.post(
      '/api/v1/transactions',
      expense({
        description: 'Weekly shop',
        lines: [
          { categoryId: ids.groceries, amount: 30000, tagIds: [ids.trip] },
          { categoryId: ids.cafe, amount: 4550, memo: 'Coffee' },
        ],
      }),
    );
    expect(res.statusCode).toBe(201);
    const t = res.json() as Transaction;
    expect(t).toMatchObject({ type: 'expense', amount: 34550, status: 'cleared', description: 'Weekly shop' });
    expect(t.lines).toEqual([
      expect.objectContaining({ categoryId: ids.groceries, amount: 30000, tagIds: [ids.trip] }),
      expect.objectContaining({ categoryId: ids.cafe, amount: 4550, memo: 'Coffee', tagIds: [] }),
    ]);
    expect((await api.get(`/api/v1/accounts/${ids.checking}`)).json().balance).toBe(100000 - 34550);
    expect((await api.get(`/api/v1/tags/${ids.trip}`)).json().usageCount).toBe(1);
    expect((await api.get(`/api/v1/transactions/${t.id}`)).json()).toEqual(t);
  });

  it('replaces lines on update and deletes', async () => {
    const t = (await api.post('/api/v1/transactions', expense({ lines: [{ categoryId: ids.groceries, amount: 100, tagIds: [ids.trip] }] }))).json();
    const updated = await api.put(`/api/v1/transactions/${t.id}`, {
      type: 'income',
      date: '2026-10-25',
      accountId: ids.checking,
      lines: [{ categoryId: ids.salary, amount: 5000000 }],
      status: 'reconciled',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ type: 'income', amount: 5000000, recipientId: null, status: 'reconciled' });
    expect(updated.json().lines).toHaveLength(1);
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM transaction_line_tags').get() as { n: number }).n).toBe(0);

    expect((await api.del(`/api/v1/transactions/${t.id}`)).statusCode).toBe(204);
    expect((await api.get(`/api/v1/transactions/${t.id}`)).statusCode).toBe(404);
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM transaction_lines').get() as { n: number }).n).toBe(0);
    expect((await api.put('/api/v1/transactions/999', expense())).statusCode).toBe(404);
  });

  it('records transfers between accounts', async () => {
    const res = await api.post('/api/v1/transactions', {
      type: 'transfer',
      date: '2026-10-06',
      accountId: ids.checking,
      toAccountId: ids.savings,
      amount: 20000,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ amount: 20000, toAccountId: ids.savings, lines: [] });
    expect((await api.get(`/api/v1/accounts/${ids.savings}`)).json().balance).toBe(20000);
    expect((await api.get(`/api/v1/accounts/${ids.checking}`)).json().balance).toBe(80000);
  });

  it('validates input', async () => {
    const bad = async (body: unknown) => {
      const res = await api.post('/api/v1/transactions', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      return res.json().message as string;
    };
    await bad(expense({ lines: [] }));
    await bad(expense({ lines: [{ categoryId: ids.groceries, amount: 0 }] }));
    await bad(expense({ lines: [{ categoryId: ids.groceries, amount: 12.5 }] }));
    await bad(expense({ amount: 999 }));
    await bad(expense({ date: '05.10.2026' }));
    expect(await bad(expense({ lines: [{ categoryId: ids.salary, amount: 100 }] }))).toMatch(/expense categories/);
    await bad(expense({ lines: [{ categoryId: 999, amount: 100 }] }));
    await bad(expense({ lines: [{ categoryId: ids.food, amount: 100, tagIds: [999] }] }));
    await bad(expense({ accountId: 999 }));
    await bad(expense({ recipientId: 999 }));
    await bad({ type: 'transfer', date: '2026-10-01', accountId: ids.checking, toAccountId: ids.checking, amount: 100 });
    await bad({ type: 'transfer', date: '2026-10-01', accountId: ids.checking, amount: 100 });
    await bad({ type: 'transfer', date: '2026-10-01', accountId: ids.checking, toAccountId: ids.savings });
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(0);
  });

  it('allows uncategorised lines and checks a total against the lines', async () => {
    const res = await api.post('/api/v1/transactions', expense({ amount: 300, lines: [{ amount: 100 }, { amount: 200 }] }));
    expect(res.statusCode).toBe(201);
    expect(res.json().lines.map((l: { categoryId: number | null }) => l.categoryId)).toEqual([null, null]);
  });

  it('finds or creates the recipient by name', async () => {
    const existing = (await api.post('/api/v1/transactions', expense({ recipientId: null, recipientName: 'kiwi' }))).json();
    expect(existing.recipientId).toBe(ids.kiwi);
    const created = (await api.post('/api/v1/transactions', expense({ recipientId: null, recipientName: 'Rema 1000' }))).json();
    const rema = (await api.get(`/api/v1/recipients/${created.recipientId}`)).json();
    expect(rema).toMatchObject({ name: 'Rema 1000', transactionCount: 1 });
  });

  it('does not duplicate a retried create with the same clientId', async () => {
    const clientId = '3f1c2a9e-8b7d-4c6e-9f00-112233445566';
    const first = await api.post('/api/v1/transactions', expense({ clientId }));
    const again = await api.post('/api/v1/transactions', expense({ clientId }));
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(first.json().id);
    expect((await list()).count).toBe(1);
  });

  it('needs transactions permissions', async () => {
    const role = sqlite.prepare("INSERT INTO roles (name, permissions) VALUES ('Viewer', ?)").run(JSON.stringify(['transactions:read']));
    sqlite
      .prepare('INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)')
      .run('Viewer', 'viewer@example.com', await hashPassword('viewer password'), role.lastInsertRowid);
    const viewer = client(app, await login(app, { email: 'viewer@example.com', password: 'viewer password' }));
    expect((await viewer.get('/api/v1/transactions')).statusCode).toBe(200);
    expect((await viewer.post('/api/v1/transactions', expense())).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/transactions' })).statusCode).toBe(401);
  });
});

describe('transaction list filters', () => {
  beforeEach(async () => {
    const add = async (body: unknown) => expect((await api.post('/api/v1/transactions', body)).statusCode).toBe(201);
    await add(expense({ date: '2026-09-30', description: 'Old 50% sale', lines: [{ categoryId: ids.groceries, amount: 1000 }] }));
    await add(
      expense({
        date: '2026-10-02',
        lines: [
          { categoryId: ids.groceries, amount: 2000, tagIds: [ids.trip] },
          { categoryId: ids.cafe, amount: 500, memo: 'Bolle' },
        ],
      }),
    );
    await add(expense({ date: '2026-10-03', recipientId: null, lines: [{ categoryId: ids.food, amount: 300 }] }));
    await add(expense({ date: '2026-10-04', recipientId: null, lines: [{ amount: 40 }] }));
    await add({ type: 'income', date: '2026-10-25', accountId: ids.checking, lines: [{ categoryId: ids.salary, amount: 100000 }] });
    await add({ type: 'transfer', date: '2026-10-26', accountId: ids.checking, toAccountId: ids.savings, amount: 7000 });
  });

  it('lists newest first with totals and paging', async () => {
    const all = await list();
    expect(all.count).toBe(6);
    expect(all.items.map((t) => t.date)).toEqual(['2026-10-26', '2026-10-25', '2026-10-04', '2026-10-03', '2026-10-02', '2026-09-30']);
    expect(all).toMatchObject({ income: 100000, expense: 3840, net: 100000 - 3840 });
    const page = await list('?limit=2&offset=2');
    expect(page.items.map((t) => t.date)).toEqual(['2026-10-04', '2026-10-03']);
    expect(page.count).toBe(6);
  });

  it('filters by date, type, account, recipient and amount', async () => {
    expect((await list('?from=2026-10-01&to=2026-10-31')).count).toBe(5);
    expect((await list('?type=expense')).count).toBe(4);
    expect((await list(`?accountId=${ids.savings}`)).items.map((t) => t.type)).toEqual(['transfer']);
    expect((await list(`?recipientId=${ids.kiwi}`)).count).toBe(2);
    expect((await list('?minAmount=1000&maxAmount=5000')).items.map((t) => t.amount)).toEqual([2500, 1000]);
    // Empty values from a form are ignored.
    expect((await list('?type=&accountId=&q=')).count).toBe(6);
    expect((await api.get('/api/v1/transactions?from=October')).statusCode).toBe(400);
  });

  it('filters lines by category subtree and tag, totalling only matching lines', async () => {
    const food = await list(`?categoryId=${ids.food}`);
    expect(food.count).toBe(3);
    expect(food.expense).toBe(1000 + 2000 + 300);
    const cafe = await list(`?categoryId=${ids.cafe}`);
    expect(cafe.count).toBe(1);
    expect(cafe.expense).toBe(500);
    const tagged = await list(`?tagId=${ids.trip}`);
    expect(tagged).toMatchObject({ count: 1, expense: 2000 });
    expect((await list('?uncategorized=true')).expense).toBe(40);
  });

  it('searches description, recipient and memo, treating % literally', async () => {
    expect((await list('?q=bolle')).count).toBe(1);
    expect((await list('?q=KIWI')).count).toBe(2);
    expect((await list(`?q=${encodeURIComponent('50%')}`)).count).toBe(1);
    expect((await list(`?q=${encodeURIComponent('%')}`)).count).toBe(1);
  });
});

describe('saved filters', () => {
  it('saves, renames and deletes per user', async () => {
    const created = await api.post('/api/v1/saved-filters', { name: 'Food this year', filter: { categoryId: ids.food, from: '2026-01-01' } });
    expect(created.statusCode).toBe(201);
    const saved = created.json();
    expect(saved).toMatchObject({ name: 'Food this year', filter: { categoryId: ids.food, from: '2026-01-01' } });
    expect((await api.post('/api/v1/saved-filters', { name: 'food THIS year', filter: {} })).statusCode).toBe(409);
    expect((await api.post('/api/v1/saved-filters', { name: 'Bad', filter: { from: 'yesterday' } })).statusCode).toBe(400);

    const renamed = await api.patch(`/api/v1/saved-filters/${saved.id}`, { name: 'Food' });
    expect(renamed.json()).toMatchObject({ name: 'Food', filter: { categoryId: ids.food } });

    const role = sqlite.prepare('SELECT role_id AS roleId FROM users').get() as { roleId: number };
    sqlite
      .prepare('INSERT INTO users (name, email, password_hash, role_id) VALUES (?, ?, ?, ?)')
      .run('Other', 'other@example.com', await hashPassword('other password'), role.roleId);
    const other = client(app, await login(app, { email: 'other@example.com', password: 'other password' }));
    expect((await other.get('/api/v1/saved-filters')).json()).toEqual([]);
    expect((await other.del(`/api/v1/saved-filters/${saved.id}`)).statusCode).toBe(404);

    expect((await api.get('/api/v1/saved-filters')).json()).toHaveLength(1);
    expect((await api.del(`/api/v1/saved-filters/${saved.id}`)).statusCode).toBe(204);
    expect((await api.get('/api/v1/saved-filters')).json()).toEqual([]);
  });
});

describe('dashboard', () => {
  it('shifts months', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-10', -5)).toBe('2026-05');
  });

  it('summarises a month, rolls categories up to the top level and lists recent transactions', async () => {
    await api.post('/api/v1/transactions', expense({ date: '2026-09-15', lines: [{ categoryId: ids.groceries, amount: 9000 }] }));
    await api.post(
      '/api/v1/transactions',
      expense({ lines: [{ categoryId: ids.groceries, amount: 2000 }, { categoryId: ids.food, amount: 1000 }, { categoryId: ids.cafe, amount: 500 }] }),
    );
    await api.post('/api/v1/transactions', expense({ lines: [{ amount: 250 }] }));
    await api.post('/api/v1/transactions', { type: 'income', date: '2026-10-25', accountId: ids.checking, lines: [{ categoryId: ids.salary, amount: 50000 }] });
    await api.post('/api/v1/transactions', { type: 'transfer', date: '2026-10-26', accountId: ids.checking, toAccountId: ids.savings, amount: 7000 });

    const res = await api.get('/api/v1/dashboard?month=2026-10');
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.current).toEqual({ month: '2026-10', income: 50000, expense: 3750, net: 46250 });
    expect(d.previous).toEqual({ month: '2026-09', income: 0, expense: 9000, net: -9000 });
    expect(d.expenseByCategory).toEqual([
      { categoryId: ids.food, amount: 3000 },
      { categoryId: ids.cafe, amount: 500 },
      { categoryId: null, amount: 250 },
    ]);
    expect(d.trend.map((m: { month: string }) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(d.recent[0]).toMatchObject({ type: 'transfer' });
    expect(d.recent).toHaveLength(5);
    expect((await api.get('/api/v1/dashboard?month=2026-13')).statusCode).toBe(400);
  });
});
