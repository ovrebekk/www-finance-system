import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  categoryDeleteQuerySchema,
  categoryInputSchema,
  categoryUpdateSchema,
  descendantIds,
  idParamSchema,
  type Category,
} from '@finance/shared';
import { categories } from '../db/schema.js';
import { currentUser } from '../lib/auth.js';
import { bools, nowIso, type AppContext } from '../lib/context.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

const SELECT = `
  SELECT c.id, c.name, c.kind, c.parent_id AS parentId, c.archived, c.sort_order AS sortOrder,
         (SELECT COUNT(*) FROM transaction_lines l WHERE l.category_id = c.id) AS usageCount
  FROM categories c`;

export function categoryRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, sqlite, guards } = ctx;
  const listStmt = sqlite.prepare(`${SELECT} ORDER BY c.kind, c.sort_order, c.name COLLATE NOCASE`);
  const oneStmt = sqlite.prepare(`${SELECT} WHERE c.id = ?`);
  const childCountStmt = sqlite.prepare('SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?');

  const all = () => (listStmt.all() as Category[]).map((r) => bools(r, 'archived'));
  const getOne = (id: number, what = 'Category'): Category => {
    const row = oneStmt.get(id) as Category | undefined;
    if (!row) throw notFound(what);
    return bools(row, 'archived');
  };

  /** Validates that `parentId` can be the parent of `self` (same kind, no cycle). */
  const checkParent = (parentId: number | null, kind: Category['kind'], selfId?: number) => {
    if (parentId == null) return;
    const parent = getOne(parentId, 'Parent category');
    if (parent.kind !== kind) throw badRequest(`The parent must be an ${kind} category`);
    if (selfId !== undefined && descendantIds(all(), selfId).has(parentId)) {
      throw badRequest('A category cannot be moved under itself or one of its subcategories');
    }
  };

  app.get('/api/v1/categories', { preHandler: guards.requirePermission('categories:read') }, async () => all());

  app.get('/api/v1/categories/:id', { preHandler: guards.requirePermission('categories:read') }, async (req) =>
    getOne(idParamSchema.parse(req.params).id),
  );

  app.post('/api/v1/categories', { preHandler: guards.requirePermission('categories:write') }, async (req, reply) => {
    const input = categoryInputSchema.parse(req.body);
    checkParent(input.parentId, input.kind);
    const me = currentUser(req);
    const { id } = db
      .insert(categories)
      .values({ ...input, createdBy: me.id, updatedBy: me.id })
      .returning({ id: categories.id })
      .get();
    reply.code(201);
    return getOne(id);
  });

  app.patch('/api/v1/categories/:id', { preHandler: guards.requirePermission('categories:write') }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const input = categoryUpdateSchema.parse(req.body);
    const current = getOne(id);
    if (input.parentId !== undefined) checkParent(input.parentId, current.kind, id);
    db.update(categories)
      .set({ ...input, updatedAt: nowIso(), updatedBy: currentUser(req).id })
      .where(eq(categories.id, id))
      .run();
    return getOne(id);
  });

  /**
   * DELETE /categories/:id?moveTo=<id>
   * A category that has transaction lines or subcategories needs `moveTo`: its
   * lines and its direct children are moved there before it is deleted.
   */
  app.delete('/api/v1/categories/:id', { preHandler: guards.requirePermission('categories:write') }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const { moveTo } = categoryDeleteQuerySchema.parse(req.query);
    const category = getOne(id);
    const childCount = (childCountStmt.get(id) as { n: number }).n;
    const needsTarget = category.usageCount > 0 || childCount > 0;

    if (needsTarget && moveTo === undefined) {
      throw conflict(
        'needs_target',
        'This category is in use. Choose a category to move its transactions and subcategories to.',
        { usageCount: category.usageCount, childCount },
      );
    }
    if (moveTo !== undefined) {
      const target = getOne(moveTo, 'Target category');
      if (target.kind !== category.kind) throw badRequest(`The target must be an ${category.kind} category`);
      if (descendantIds(all(), id).has(moveTo)) {
        throw badRequest('The target cannot be the category itself or one of its subcategories');
      }
    }

    sqlite.transaction(() => {
      if (moveTo !== undefined) {
        sqlite.prepare('UPDATE transaction_lines SET category_id = ? WHERE category_id = ?').run(moveTo, id);
        sqlite
          .prepare('UPDATE categories SET parent_id = ?, updated_at = ?, updated_by = ? WHERE parent_id = ?')
          .run(moveTo, nowIso(), currentUser(req).id, id);
      }
      sqlite.prepare('DELETE FROM categories WHERE id = ?').run(id);
    })();
    reply.code(204);
  });
}
