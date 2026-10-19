import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { accountInputSchema, accountUpdateSchema, idParamSchema, type Account } from '@finance/shared';
import { accounts } from '../db/schema.js';
import { currentUser } from '../lib/auth.js';
import { bools, nowIso, type AppContext } from '../lib/context.js';
import { conflict, notFound } from '../lib/errors.js';

const SELECT = `
  SELECT a.id, a.name, a.type, a.opening_balance AS openingBalance, a.opening_date AS openingDate,
         a.archived, a.sort_order AS sortOrder, a.notes,
         a.opening_balance
           + COALESCE((SELECT SUM(CASE t.type WHEN 'income' THEN t.amount ELSE -t.amount END)
                       FROM transactions t WHERE t.account_id = a.id), 0)
           + COALESCE((SELECT SUM(t.amount) FROM transactions t
                       WHERE t.to_account_id = a.id AND t.type = 'transfer'), 0) AS balance,
         (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id OR t.to_account_id = a.id) AS transactionCount
  FROM accounts a`;

export function accountRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, sqlite, guards } = ctx;
  const listStmt = sqlite.prepare(`${SELECT} ORDER BY a.archived, a.sort_order, a.name COLLATE NOCASE`);
  const oneStmt = sqlite.prepare(`${SELECT} WHERE a.id = ?`);

  const getOne = (id: number): Account => {
    const row = oneStmt.get(id) as Account | undefined;
    if (!row) throw notFound('Account');
    return bools(row, 'archived');
  };

  app.get('/api/v1/accounts', { preHandler: guards.requirePermission('accounts:read') }, async () =>
    (listStmt.all() as Account[]).map((r) => bools(r, 'archived')),
  );

  app.get('/api/v1/accounts/:id', { preHandler: guards.requirePermission('accounts:read') }, async (req) =>
    getOne(idParamSchema.parse(req.params).id),
  );

  app.post('/api/v1/accounts', { preHandler: guards.requirePermission('accounts:write') }, async (req, reply) => {
    const input = accountInputSchema.parse(req.body);
    const me = currentUser(req);
    const { id } = db
      .insert(accounts)
      .values({ ...input, createdBy: me.id, updatedBy: me.id })
      .returning({ id: accounts.id })
      .get();
    reply.code(201);
    return getOne(id);
  });

  app.patch('/api/v1/accounts/:id', { preHandler: guards.requirePermission('accounts:write') }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const input = accountUpdateSchema.parse(req.body);
    getOne(id);
    db.update(accounts)
      .set({ ...input, updatedAt: nowIso(), updatedBy: currentUser(req).id })
      .where(eq(accounts.id, id))
      .run();
    return getOne(id);
  });

  app.delete('/api/v1/accounts/:id', { preHandler: guards.requirePermission('accounts:write') }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const account = getOne(id);
    if (account.transactionCount > 0) {
      throw conflict(
        'in_use',
        `This account has ${account.transactionCount} transactions and cannot be deleted. Archive it instead.`,
        { transactionCount: account.transactionCount },
      );
    }
    db.delete(accounts).where(eq(accounts.id, id)).run();
    reply.code(204);
  });
}
