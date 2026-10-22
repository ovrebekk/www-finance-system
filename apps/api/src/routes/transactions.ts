import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { idParamSchema, transactionInputSchema, transactionListQuerySchema, type TransactionPage } from '@finance/shared';
import { currentUser } from '../lib/auth.js';
import { nowIso, type AppContext } from '../lib/context.js';
import { badRequest } from '../lib/errors.js';
import { filterToSql, filterTotals, loadTransaction, loadTransactions } from '../lib/transactions.js';

type Input = z.output<typeof transactionInputSchema>;

export function transactionRoutes(app: FastifyInstance, ctx: AppContext) {
  const { sqlite, guards } = ctx;
  const exists = (table: string) => sqlite.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
  const accountExists = exists('accounts');
  const recipientExists = exists('recipients');
  const tagExists = exists('tags');
  const categoryKind = sqlite.prepare('SELECT kind FROM categories WHERE id = ?');
  const recipientByName = sqlite.prepare('SELECT id FROM recipients WHERE lower(name) = lower(?)');
  const insertRecipient = sqlite.prepare('INSERT INTO recipients (name, created_by, updated_by) VALUES (?, ?, ?)');
  const byClientId = sqlite.prepare('SELECT id FROM transactions WHERE client_id = ?');
  const insertTransaction = sqlite.prepare(
    `INSERT INTO transactions (type, date, amount, account_id, to_account_id, recipient_id, description, status, client_id, created_by, updated_by)
     VALUES (@type, @date, @amount, @accountId, @toAccountId, @recipientId, @description, @status, @clientId, @userId, @userId)`,
  );
  const updateTransaction = sqlite.prepare(
    `UPDATE transactions SET type = @type, date = @date, amount = @amount, account_id = @accountId, to_account_id = @toAccountId,
       recipient_id = @recipientId, description = @description, status = @status, updated_at = @now, updated_by = @userId
     WHERE id = @id`,
  );
  const deleteLines = sqlite.prepare('DELETE FROM transaction_lines WHERE transaction_id = ?');
  const insertLine = sqlite.prepare(
    'INSERT INTO transaction_lines (transaction_id, category_id, amount, memo, sort_order) VALUES (?, ?, ?, ?, ?)',
  );
  const insertLineTag = sqlite.prepare('INSERT OR IGNORE INTO transaction_line_tags (line_id, tag_id) VALUES (?, ?)');

  /** Checks references and resolves `recipientName`; returns the recipient id to store. */
  const resolve = (input: Input, userId: number): number | null => {
    if (!accountExists.get(input.accountId)) throw badRequest('Account not found');
    if (input.toAccountId != null && !accountExists.get(input.toAccountId)) throw badRequest('Destination account not found');
    for (const line of input.lines) {
      if (line.categoryId != null) {
        const row = categoryKind.get(line.categoryId) as { kind: string } | undefined;
        if (!row) throw badRequest('Category not found');
        if (row.kind !== input.type) throw badRequest(`Use ${input.type} categories on an ${input.type} transaction`);
      }
      for (const tagId of line.tagIds) if (!tagExists.get(tagId)) throw badRequest('Tag not found');
    }
    if (input.recipientId != null) {
      if (!recipientExists.get(input.recipientId)) throw badRequest('Recipient not found');
      return input.recipientId;
    }
    if (input.recipientName) {
      const found = recipientByName.get(input.recipientName) as { id: number } | undefined;
      return found ? found.id : Number(insertRecipient.run(input.recipientName, userId, userId).lastInsertRowid);
    }
    return null;
  };

  const writeLines = (transactionId: number, input: Input) => {
    input.lines.forEach((line, i) => {
      const lineId = insertLine.run(transactionId, line.categoryId, line.amount, line.memo, i).lastInsertRowid;
      for (const tagId of line.tagIds) insertLineTag.run(lineId, tagId);
    });
  };

  const amountOf = (input: Input) =>
    input.type === 'transfer' ? input.amount! : input.lines.reduce((sum, l) => sum + l.amount, 0);

  app.get('/api/v1/transactions', { preHandler: guards.requirePermission('transactions:read') }, async (req): Promise<TransactionPage> => {
    const { limit, offset, ...filter } = transactionListQuerySchema.parse(req.query);
    const sql = filterToSql(sqlite, filter);
    const ids = (
      sqlite
        .prepare(`SELECT t.id FROM transactions t WHERE ${sql.where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`)
        .all(...sql.params, limit, offset) as { id: number }[]
    ).map((r) => r.id);
    const { count } = sqlite.prepare(`SELECT COUNT(*) AS count FROM transactions t WHERE ${sql.where}`).get(...sql.params) as {
      count: number;
    };
    return { items: loadTransactions(sqlite, ids), count, ...filterTotals(sqlite, sql) };
  });

  app.get('/api/v1/transactions/:id', { preHandler: guards.requirePermission('transactions:read') }, async (req) =>
    loadTransaction(sqlite, idParamSchema.parse(req.params).id),
  );

  /** Creating twice with the same clientId returns the first transaction (200) instead of a duplicate. */
  app.post('/api/v1/transactions', { preHandler: guards.requirePermission('transactions:write') }, async (req, reply) => {
    const input = transactionInputSchema.parse(req.body);
    const me = currentUser(req);
    if (input.clientId) {
      const existing = byClientId.get(input.clientId) as { id: number } | undefined;
      if (existing) return loadTransaction(sqlite, existing.id);
    }
    const id = sqlite.transaction(() => {
      const recipientId = resolve(input, me.id);
      const newId = Number(
        insertTransaction.run({ ...input, recipientId, amount: amountOf(input), userId: me.id }).lastInsertRowid,
      );
      writeLines(newId, input);
      return newId;
    })();
    reply.code(201);
    return loadTransaction(sqlite, id);
  });

  /** Replaces the whole transaction, lines included. */
  app.put('/api/v1/transactions/:id', { preHandler: guards.requirePermission('transactions:write') }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const input = transactionInputSchema.parse(req.body);
    const me = currentUser(req);
    loadTransaction(sqlite, id);
    sqlite.transaction(() => {
      const recipientId = resolve(input, me.id);
      updateTransaction.run({ ...input, id, recipientId, amount: amountOf(input), userId: me.id, now: nowIso() });
      deleteLines.run(id);
      writeLines(id, input);
    })();
    return loadTransaction(sqlite, id);
  });

  app.delete('/api/v1/transactions/:id', { preHandler: guards.requirePermission('transactions:write') }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    loadTransaction(sqlite, id);
    sqlite.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    reply.code(204);
  });
}
