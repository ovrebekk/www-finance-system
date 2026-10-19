import { count, eq } from 'drizzle-orm';
import { OWNER_ROLE, PERMISSIONS } from '@finance/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { roles, users } from '../db/schema.js';
import type { Config } from './config.js';
import { hashPassword } from './passwords.js';

/** Makes sure the Owner role exists and holds every permission (new ones included). */
export function ensureOwnerRole(db: Db): number {
  const existing = db.select().from(roles).where(eq(roles.name, OWNER_ROLE)).get();
  const permissions = [...PERMISSIONS];
  if (existing) {
    db.update(roles).set({ permissions }).where(eq(roles.id, existing.id)).run();
    return existing.id;
  }
  return db.insert(roles).values({ name: OWNER_ROLE, permissions }).returning({ id: roles.id }).get().id;
}

/** Creates the first user from ADMIN_EMAIL / ADMIN_PASSWORD when no user exists. */
export async function ensureFirstUser(db: Db, config: Config, log: FastifyBaseLogger): Promise<void> {
  const ownerRoleId = ensureOwnerRole(db);
  const userCount = db.select({ n: count() }).from(users).get()?.n ?? 0;
  if (userCount > 0) return;
  if (!config.adminEmail || !config.adminPassword) {
    log.warn('No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first login.');
    return;
  }
  db.insert(users)
    .values({
      name: config.adminName,
      email: config.adminEmail,
      passwordHash: await hashPassword(config.adminPassword),
      roleId: ownerRoleId,
    })
    .run();
  log.info({ email: config.adminEmail }, 'Created first user with the Owner role');
}
