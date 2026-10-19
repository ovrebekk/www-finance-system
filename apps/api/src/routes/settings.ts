import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppContext } from '../lib/context.js';
import { writeBackup } from '../lib/backup.js';

export function settingsRoutes(app: FastifyInstance, ctx: AppContext) {
  const { sqlite, guards } = ctx;

  /** Downloads a consistent copy of the whole database. */
  app.get('/api/v1/settings/backup', { preHandler: guards.requirePermission('settings:admin') }, async (_req, reply) => {
    const dir = await mkdtemp(join(tmpdir(), 'finance-backup-'));
    const date = new Date().toISOString().slice(0, 10);
    const file = writeBackup(sqlite, join(dir, `finance-${date}.sqlite`));
    const stream = createReadStream(file);
    stream.on('close', () => void rm(dir, { recursive: true, force: true }));
    reply
      .header('Content-Type', 'application/vnd.sqlite3')
      .header('Content-Disposition', `attachment; filename="finance-${date}.sqlite"`)
      .header('Cache-Control', 'no-store');
    return reply.send(stream);
  });

  /** Users and their roles (read-only in release 1). */
  app.get('/api/v1/users', { preHandler: guards.requirePermission('users:admin') }, async () =>
    sqlite
      .prepare(
        `SELECT u.id, u.name, u.email, u.active, r.name AS role, u.created_at AS createdAt
         FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.name COLLATE NOCASE`,
      )
      .all()
      .map((u) => ({ ...(u as Record<string, unknown>), active: Boolean((u as { active: number }).active) })),
  );

  app.get('/api/v1/roles', { preHandler: guards.requirePermission('users:admin') }, async () =>
    (sqlite.prepare('SELECT id, name, permissions FROM roles ORDER BY name').all() as { permissions: string }[]).map(
      (r) => ({ ...r, permissions: JSON.parse(r.permissions) as string[] }),
    ),
  );
}
