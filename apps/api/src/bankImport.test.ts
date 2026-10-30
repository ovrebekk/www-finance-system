import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BankImportPreview, BankImportResult, Recipient, TransactionPage } from '@finance/shared';
import { randomUUID } from 'node:crypto';
import { buildTestApp, client, login } from './test/helpers.js';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let ids: { checking: number; savings: number; power: number; salary: number; elvia: number };

beforeEach(async () => {
  app = (await buildTestApp()).app;
  api = client(app, await login(app));
  const post = async (url: string, body: unknown) => (await api.post(url, body)).json().id as number;
  const power = await post('/api/v1/categories', { name: 'Strøm', kind: 'expense' });
  ids = {
    checking: await post('/api/v1/accounts', { name: 'Brukskonto 1234.56.78901', type: 'checking', openingDate: '2026-01-01' }),
    savings: await post('/api/v1/accounts', { name: 'Sparekonto', type: 'savings', openingDate: '2026-01-01', notes: 'Kontonr 1234 56 99999' }),
    power,
    salary: await post('/api/v1/categories', { name: 'Lønn', kind: 'income' }),
    elvia: await post('/api/v1/recipients', { name: 'Elvia AS', defaultCategoryId: power }),
  };
});

afterEach(async () => {
  await app.close();
});

/** Same shape as Nordea's netbank export: BOM, semicolons, YYYY/MM/DD, comma decimals. */
const nordeaFile = (...rows: string[]) =>
  '﻿Bokføringsdato;Beløp;Avsender;Mottaker;Navn;Tittel;Valuta;Betalingstype\n' + rows.join('\n') + '\n';

const sample = nordeaFile(
  '2026/03/30;-29,00;1234.56.78901;;;Omkostninger;NOK;Omkostninger',
  '2026/03/18;-1 287,82;1234.56.78901;;;ELVIA AS;NOK;Avtalegiro',
  '2026/03/16;28000,00;;1234.56.78901;;Arbeidsgiver AS;NOK;Fast oppdrag',
  '2026/03/09;-4000,00;1234.56.78901;;;12345699999;NOK;Kontoregulering',
  '2026/03/09;-300,00;1234.56.78901;;;OLA NORDMANN;NOK;Kontoregulering',
  '2026/03/08;-500,00;1234.56.78901;;Kari Nordmann;Lunsj;NOK;Overførsel',
  '2026/03/07;-3000,00;1234.56.78901;;;BETALING PÅ LÅN 1234.56.99999;NOK;Lån',
  'Reservert;-120,50;1234.56.78901;;;KIWI 123;NOK;Varekjøp',
);

const preview = async (content: string, extra: Record<string, unknown> = {}) => {
  const res = await api.post('/api/v1/import/bank/preview', { content, fileName: 'Brukskonto.csv', ...extra });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as BankImportPreview;
};

describe('bank import preview (Nordea)', () => {
  it('detects the format and the account, and suggests transactions', async () => {
    const p = await preview(sample);
    expect(p.format).toBe('nordea');
    expect(p.accountNumber).toBe('1234.56.78901');
    expect(p.accountId).toBe(ids.checking);
    expect(p.problems).toEqual([]);
    expect(p.rows.map((r) => [r.line, r.date, r.amount, r.suggestion.type])).toEqual([
      [2, '2026-03-30', -2900, 'expense'],
      [3, '2026-03-18', -128782, 'expense'],
      [4, '2026-03-16', 2800000, 'income'],
      [5, '2026-03-09', -400000, 'transfer'],
      [6, '2026-03-09', -30000, 'expense'],
      [7, '2026-03-08', -50000, 'expense'],
      [8, '2026-03-07', -300000, 'transfer'],
      [9, null, -12050, 'expense'],
    ]);
    const [fee, elvia, salary, transfer, unknownTransfer, kari, loan, reserved] = p.rows;
    // An existing recipient matches case-insensitively and brings its default category.
    expect(elvia!.suggestion).toMatchObject({ recipientId: ids.elvia, recipientName: 'Elvia AS', categoryId: ids.power });
    expect(fee!.suggestion).toMatchObject({ recipientId: null, recipientName: 'Omkostninger', categoryId: null });
    expect(salary!.suggestion.categoryId).toBeNull();
    // An account number found in another account's notes makes the row a transfer.
    expect(transfer!.otherAccountNumber).toBe('12345699999');
    expect(transfer!.suggestion).toMatchObject({ otherAccountId: ids.savings, recipientName: null });
    // Navn is the counterparty and Tittel the message when both are there.
    expect(kari!.suggestion).toMatchObject({ recipientName: 'Kari Nordmann', description: 'Lunsj' });
    expect(kari!.warnings).toEqual([]);
    // A Nordea account transfer to a number we do not know stays an expense, with a hint.
    expect(unknownTransfer!.warnings.join()).toMatch(/choose Transfer/);
    expect(loan!.suggestion.otherAccountId).toBe(ids.savings);
    expect(reserved!.reserved).toBe(true);
    expect(reserved!.warnings.join()).toMatch(/Reserved/);
  });

  it('reports unreadable rows and rejects files in an unknown format', async () => {
    const p = await preview(nordeaFile('2026/13/01;-1,00;;;;X;NOK;Y', '2026/03/01;abc;;;;X;NOK;Y', '2026/03/02;-5,00;;;;Ok;NOK;Y'));
    expect(p.rows).toHaveLength(1);
    expect(p.problems).toEqual(["Line 2: '2026/13/01' is not a date", "Line 3: 'abc' is not an amount"]);
    expect(p.accountId).toBeNull();

    const res = await api.post('/api/v1/import/bank/preview', { content: 'Dato,Tekst,Beløp\n2026-01-01,x,1\n' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/not in a bank format/);
  });

  it('flags rows that are already on the account, one match per row', async () => {
    await api.post('/api/v1/transactions', {
      type: 'expense',
      date: '2026-03-30',
      accountId: ids.checking,
      lines: [{ amount: 2900 }],
    });
    const file = nordeaFile(
      '2026/03/30;-29,00;1234.56.78901;;;Omkostninger;NOK;Omkostninger',
      '2026/03/30;-29,00;1234.56.78901;;;Omkostninger;NOK;Omkostninger',
    );
    const p = await preview(file);
    expect(p.rows[0]!.duplicateOf).not.toBeNull();
    expect(p.rows[1]!.duplicateOf).toBeNull();
    // Against another account nothing matches.
    expect((await preview(file, { accountId: ids.savings })).rows.every((r) => r.duplicateOf === null)).toBe(true);
  });
});

describe('bank import commit', () => {
  const expenseRow = (line: number, over: Record<string, unknown> = {}) => ({
    line,
    transaction: {
      type: 'expense',
      date: '2026-03-30',
      accountId: ids.checking,
      recipientName: 'Omkostninger',
      lines: [{ amount: 2900, categoryId: null }],
      clientId: randomUUID(),
      ...over,
    },
  });

  it('saves all rows, creates recipients and saves default categories', async () => {
    const rows = [
      expenseRow(2, { lines: [{ amount: 2900, categoryId: ids.power }] }),
      { line: 5, transaction: { type: 'transfer', date: '2026-03-09', accountId: ids.checking, toAccountId: ids.savings, amount: 400000, clientId: randomUUID() } },
    ];
    const res = await api.post('/api/v1/import/bank/commit', { rows });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ created: 2, recipientsCreated: 1, defaultsSaved: 1 });

    const recipients = (await api.get('/api/v1/recipients')).json() as Recipient[];
    expect(recipients.find((r) => r.name === 'Omkostninger')?.defaultCategoryId).toBe(ids.power);

    // Sending the same rows again (a retry) creates nothing new.
    const again = (await api.post('/api/v1/import/bank/commit', { rows })).json() as BankImportResult;
    expect(again.created).toBe(0);
    expect((await api.get('/api/v1/transactions')).json().count).toBe(2);
  });

  it('saves nothing when one row is invalid', async () => {
    const res = await api.post('/api/v1/import/bank/commit', {
      rows: [expenseRow(2), expenseRow(3, { lines: [{ amount: 100, categoryId: ids.salary }] }), expenseRow(4, { date: '' })],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().details).toEqual(['Line 4: date: Use the format YYYY-MM-DD']);

    const second = await api.post('/api/v1/import/bank/commit', {
      rows: [expenseRow(2), expenseRow(3, { lines: [{ amount: 100, categoryId: ids.salary }] })],
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().message).toMatch(/^Line 3: Use expense categories/);
    expect(((await api.get('/api/v1/transactions')).json() as TransactionPage).count).toBe(0);
    expect(((await api.get('/api/v1/recipients')).json() as Recipient[]).map((r) => r.name)).toEqual(['Elvia AS']);
  });
});
