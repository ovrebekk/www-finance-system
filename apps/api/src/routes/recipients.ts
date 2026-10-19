import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { idParamSchema, mergeSchema, recipientInputSchema, recipientUpdateSchema, type Recipient } from '@finance/shared';
import { recipients } from '../db/schema.js';
import { currentUser } from '../lib/auth.js';
import { bools, nowIso, type AppContext } from '../lib/context.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

const SELECT = `
  SELECT r.id, r.name, r.default_category_id AS defaultCategoryId, r.notes, r.archived,
         (SELECT COUNT(*) FROM transactions t WHERE t.recipient_id = r.id) AS transactionCount,
         COALESCE((SELECT SUM(CASE t.type WHEN 'expense' THEN t.amount WHEN 'income' THEN -t.amount ELSE 0 END)
                   FROM transactions t WHERE t.recipient_id = r.id), 0) AS total
  FROM recipients r`;

export function recipientRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, sqlite, guards } = ctx;
  const listStmt = sqlite.prepare(`${SELECT} ORDER BY r.archived, r.name COLLATE NOCASE`);
  const oneStmt = sqlite.prepare(`${SELECT} WHERE r.id = ?`);

  const getOne = (id: number, what = 'Recipient'): Recipient => {
    const row = oneStmt.get(id) as Recipient | undefined;
    if (!row) throw notFound(what);
    return bools(row, 'archived');
  };
  const checkCategory = (categoryId: number | null | undefined) => {
    if (categoryId == null) return;
    if (!sqlite.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) throw badRequest('Default category not found');
  };

  app.get('/api/v1/recipients', { preHandler: guards.requirePermission('recipients:read') }, async () =>
    (listStmt.all() as Recipient[]).map((r) => bools(r, 'archived')),
  );

  app.get('/api/v1/recipients/:id', { preHandler: guards.requirePermission('recipients:read') }, async (req) =>
    getOne(idParamSchema.parse(req.params).id),
  );

  app.post('/api/v1/recipients', { preHandler: guards.requirePermission('recipients:write') }, async (req, reply) => {
    const input = recipientInputSchema.parse(req.body);
    checkCategory(input.defaultCategoryId);
    const me = currentUser(req);
    const { id } = db
      .insert(recipients)
      .values({ ...input, createdBy: me.id, updatedBy: me.id })
      .returning({ id: recipients.id })
      .get();
    reply.code(201);
    return getOne(id);
  });

  app.patch('/api/v1/recipients/:id', { preHandler: guards.requirePermission('recipients:write') }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const input = recipientUpdateSchema.parse(req.body);
    getOne(id);
    checkCategory(input.defaultCategoryId);
    db.update(recipients)
      .set({ ...input, updatedAt: nowIso(), updatedBy: currentUser(req).id })
      .where(eq(recipients.id, id))
      .run();
    return getOne(id);
  });

  app.delete('/api/v1/recipients/:id', { preHandler: guards.requirePermission('recipients:write') }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const recipient = getOne(id);
    if (recipient.transactionCount > 0) {
      throw conflict(
        'in_use',
        `This recipient is used by ${recipient.transactionCount} transactions. Merge it into another recipient or archive it.`,
        { transactionCount: recipient.transactionCount },
      );
    }
    db.delete(recipients).where(eq(recipients.id, id)).run();
    reply.code(204);
  });

  /** Moves all transactions of :id to `intoId`, then deletes :id. */
  app.post('/api/v1/recipients/:id/merge', { preHandler: guards.requirePermission('recipients:write') }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const { intoId } = mergeSchema.parse(req.body);
    if (id === intoId) throw badRequest('Choose a different recipient to merge into');
    getOne(id);
    getOne(intoId, 'Target recipient');
    sqlite.transaction(() => {
      sqlite.prepare('UPDATE transactions SET recipient_id = ? WHERE recipient_id = ?').run(intoId, id);
      sqlite.prepare('DELETE FROM recipients WHERE id = ?').run(id);
    })();
    return getOne(intoId);
  });
}
