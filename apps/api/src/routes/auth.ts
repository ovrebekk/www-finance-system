import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { loginSchema } from '@finance/shared';
import { users } from '../db/schema.js';
import { currentUser, loadMe } from '../lib/auth.js';
import type { AppContext } from '../lib/context.js';
import { HttpError } from '../lib/errors.js';
import { burnPasswordCheck, verifyPassword } from '../lib/passwords.js';

export function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, guards, config } = ctx;

  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: config.loginRateLimit, timeWindow: '1 minute' } } },
    async (req) => {
      const { email, password } = loginSchema.parse(req.body);
      const user = db.select().from(users).where(eq(users.email, email)).get();
      const ok = user ? await verifyPassword(user.passwordHash, password) : (await burnPasswordCheck(password), false);
      const me = ok && user ? loadMe(db, user.id) : null;
      if (!me) throw new HttpError(401, 'invalid_credentials', 'Wrong email or password');
      req.session.regenerate();
      req.session.set('userId', me.id);
      return me;
    },
  );

  app.post('/api/v1/auth/logout', async (req, reply) => {
    req.session.delete();
    reply.code(204);
  });

  app.get('/api/v1/auth/me', { preHandler: guards.requireAuth }, async (req) => currentUser(req));
}
