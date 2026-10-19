import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { eq } from 'drizzle-orm';
import { isPermission, type Me, type Permission } from '@finance/shared';
import type { Db } from '../db/index.js';
import { roles, users } from '../db/schema.js';
import { HttpError } from './errors.js';

declare module '@fastify/secure-session' {
  interface SessionData {
    userId: number;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    user: Me | null;
  }
}

export function loadMe(db: Db, userId: number): Me | null {
  const row = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      active: users.active,
      role: roles.name,
      permissions: roles.permissions,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, userId))
    .get();
  if (!row || !row.active) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    permissions: row.permissions.filter(isPermission),
  };
}

/** Returns the signed-in user, or throws 401. */
export function currentUser(request: FastifyRequest): Me {
  if (!request.user) throw new HttpError(401, 'unauthorized', 'Please sign in');
  return request.user;
}

export function registerAuth(app: FastifyInstance, db: Db) {
  app.decorateRequest('user', null);

  const requireAuth: preHandlerAsyncHookHandler = async (request: FastifyRequest, _reply: FastifyReply) => {
    const userId = request.session.get('userId');
    const me = typeof userId === 'number' ? loadMe(db, userId) : null;
    if (!me) {
      if (userId !== undefined) request.session.delete();
      throw new HttpError(401, 'unauthorized', 'Please sign in');
    }
    request.user = me;
  };

  /** preHandlers for a route that needs a signed-in user with `permission`. */
  const requirePermission = (permission: Permission): preHandlerAsyncHookHandler[] => [
    requireAuth,
    async (request) => {
      if (!request.user?.permissions.includes(permission)) {
        throw new HttpError(403, 'forbidden', 'You do not have permission to do this');
      }
    },
  ];

  return { requireAuth, requirePermission };
}

export type Guards = ReturnType<typeof registerAuth>;
