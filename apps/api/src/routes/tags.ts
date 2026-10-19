import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { idParamSchema, mergeSchema, tagInputSchema, tagUpdateSchema, type Tag } from '@finance/shared';
import { tags } from '../db/schema.js';
import { currentUser } from '../lib/auth.js';
import { nowIso, type AppContext } from '../lib/context.js';
import { badRequest, notFound } from '../lib/errors.js';

const SELECT = `
  SELECT g.id, g.name, g.color,
         (SELECT COUNT(*) FROM transaction_line_tags lt WHERE lt.tag_id = g.id) AS usageCount
  FROM tags g`;

export function tagRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, sqlite, guards } = ctx;
  const listStmt = sqlite.prepare(`${SELECT} ORDER BY g.name COLLATE NOCASE`);
  const oneStmt = sqlite.prepare(`${SELECT} WHERE g.id = ?`);

  const getOne = (id: number, what = 'Tag'): Tag => {
    const row = oneStmt.get(id) as Tag | undefined;
    if (!row) throw notFound(what);
    return row;
  };

  app.get('/api/v1/tags', { preHandler: guards.requirePermission('tags:read') }, async () => listStmt.all() as Tag[]);

  app.get('/api/v1/tags/:id', { preHandler: guards.requirePermission('tags:read') }, async (req) =>
    getOne(idParamSchema.parse(req.params).id),
  );

  app.post('/api/v1/tags', { preHandler: guards.requirePermission('tags:write') }, async (req, reply) => {
    const input = tagInputSchema.parse(req.body);
    const me = currentUser(req);
    const { id } = db.insert(tags).values({ ...input, createdBy: me.id, updatedBy: me.id }).returning({ id: tags.id }).get();
    reply.code(201);
    return getOne(id);
  });

  app.patch('/api/v1/tags/:id', { preHandler: guards.requirePermission('tags:write') }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const input = tagUpdateSchema.parse(req.body);
    getOne(id);
    db.update(tags).set({ ...input, updatedAt: nowIso(), updatedBy: currentUser(req).id }).where(eq(tags.id, id)).run();
    return getOne(id);
  });

  /** Deleting a tag removes it from every transaction line (the UI confirms first). */
  app.delete('/api/v1/tags/:id', { preHandler: guards.requirePermission('tags:write') }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    getOne(id);
    db.delete(tags).where(eq(tags.id, id)).run();
    reply.code(204);
  });

  /** Gives every line tagged :id the tag `intoId` instead, then deletes :id. */
  app.post('/api/v1/tags/:id/merge', { preHandler: guards.requirePermission('tags:write') }, async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const { intoId } = mergeSchema.parse(req.body);
    if (id === intoId) throw badRequest('Choose a different tag to merge into');
    getOne(id);
    getOne(intoId, 'Target tag');
    sqlite.transaction(() => {
      sqlite
        .prepare('INSERT OR IGNORE INTO transaction_line_tags (line_id, tag_id) SELECT line_id, ? FROM transaction_line_tags WHERE tag_id = ?')
        .run(intoId, id);
      sqlite.prepare('DELETE FROM tags WHERE id = ?').run(id);
    })();
    return getOne(intoId);
  });
}
