import type { FastifyInstance } from 'fastify';
import { idParamSchema, transactionInputSchema, transactionListQuerySchema, type TransactionPage } from '@finance/shared';
import { currentUser } from '../lib/auth.js';
import type { AppContext } from '../lib/context.js';
import { filterToSql, filterTotals, loadTransaction, loadTransactions, transactionWriter } from '../lib/transactions.js';

export function transactionRoutes(app: FastifyInstance, ctx: AppContext) {
  const { sqlite, guards } = ctx;
  const writer = transactionWriter(sqlite);

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
    const existing = writer.findByClientId(input.clientId);
    if (existing !== undefined) return loadTransaction(sqlite, existing);
    const id = sqlite.transaction(() => writer.create(input, me.id))();
    reply.code(201);
    return loadTransaction(sqlite, id);
  });

  /** Replaces the whole transaction, lines included. */
  app.put('/api/v1/transactions/:id', { preHandler: guards.requirePermission('transactions:write') }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const input = transactionInputSchema.parse(req.body);
    const me = currentUser(req);
    loadTransaction(sqlite, id);
    sqlite.transaction(() => writer.update(id, input, me.id))();
    return loadTransaction(sqlite, id);
  });

  app.delete('/api/v1/transactions/:id', { preHandler: guards.requirePermission('transactions:write') }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    loadTransaction(sqlite, id);
    sqlite.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    reply.code(204);
  });
}
