import type { FastifyInstance } from 'fastify';
import { idParamSchema, savedFilterInputSchema, savedFilterUpdateSchema, transactionFilterSchema, type SavedFilter } from '@finance/shared';
import { currentUser } from '../lib/auth.js';
import { nowIso, type AppContext } from '../lib/context.js';
import { notFound } from '../lib/errors.js';

/** Saved transaction-list filters. Each user sees and changes only their own. */
export function savedFilterRoutes(app: FastifyInstance, ctx: AppContext) {
  const { sqlite, guards } = ctx;
  const listStmt = sqlite.prepare('SELECT id, name, filter FROM saved_filters WHERE user_id = ? ORDER BY name COLLATE NOCASE');
  const oneStmt = sqlite.prepare('SELECT id, name, filter FROM saved_filters WHERE id = ? AND user_id = ?');

  const toFilter = (row: { id: number; name: string; filter: string }): SavedFilter => ({
    id: row.id,
    name: row.name,
    // Drop anything an older version stored that the schema no longer knows.
    filter: transactionFilterSchema.catch({}).parse(JSON.parse(row.filter)),
  });
  const getOne = (id: number, userId: number) => {
    const row = oneStmt.get(id, userId) as { id: number; name: string; filter: string } | undefined;
    if (!row) throw notFound('Saved filter');
    return toFilter(row);
  };
  const guard = { preHandler: guards.requirePermission('transactions:read') };

  app.get('/api/v1/saved-filters', guard, async (req) =>
    (listStmt.all(currentUser(req).id) as { id: number; name: string; filter: string }[]).map(toFilter),
  );

  app.post('/api/v1/saved-filters', guard, async (req, reply) => {
    const input = savedFilterInputSchema.parse(req.body);
    const me = currentUser(req);
    const { lastInsertRowid } = sqlite
      .prepare('INSERT INTO saved_filters (user_id, name, filter) VALUES (?, ?, ?)')
      .run(me.id, input.name, JSON.stringify(input.filter));
    reply.code(201);
    return getOne(Number(lastInsertRowid), me.id);
  });

  app.patch('/api/v1/saved-filters/:id', guard, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const input = savedFilterUpdateSchema.parse(req.body);
    const me = currentUser(req);
    const current = getOne(id, me.id);
    sqlite
      .prepare('UPDATE saved_filters SET name = ?, filter = ?, updated_at = ? WHERE id = ?')
      .run(input.name ?? current.name, JSON.stringify(input.filter ?? current.filter), nowIso(), id);
    return getOne(id, me.id);
  });

  app.delete('/api/v1/saved-filters/:id', guard, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const me = currentUser(req);
    getOne(id, me.id);
    sqlite.prepare('DELETE FROM saved_filters WHERE id = ?').run(id);
    reply.code(204);
  });
}
