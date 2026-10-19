import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import secureSession from '@fastify/secure-session';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { openDatabase } from './db/index.js';
import { registerAuth } from './lib/auth.js';
import { ensureFirstUser } from './lib/bootstrap.js';
import type { Config } from './lib/config.js';
import type { AppContext } from './lib/context.js';
import { HttpError } from './lib/errors.js';
import { accountRoutes } from './routes/accounts.js';
import { authRoutes } from './routes/auth.js';
import { categoryRoutes } from './routes/categories.js';
import { recipientRoutes } from './routes/recipients.js';
import { settingsRoutes } from './routes/settings.js';
import { tagRoutes } from './routes/tags.js';

const SESSION_SALT = 'finance.ovrebekk'; // 16 bytes, app-specific
const COOKIE_NAME = 'finance_session';
const THIRTY_DAYS = 30 * 24 * 60 * 60;

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
}

export async function buildApp(config: Config): Promise<BuiltApp> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.isProduction,
    bodyLimit: 20 * 1024 * 1024,
  });

  const { db, sqlite } = openDatabase(config.dbFile);
  app.addHook('onClose', async () => sqlite.close());

  await app.register(secureSession, {
    secret: config.sessionSecret,
    salt: SESSION_SALT,
    cookieName: COOKIE_NAME,
    expiry: THIRTY_DAYS,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: THIRTY_DAYS,
    },
  });
  await app.register(rateLimit, { global: false });

  const guards = registerAuth(app, db);
  const ctx: AppContext = { db, sqlite, config, guards };

  app.setErrorHandler((error: FastifyError | HttpError | ZodError, request, reply) => {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      const field = first?.path.join('.');
      return reply.code(400).send({
        error: 'validation',
        message: first ? (field ? `${field}: ${first.message}` : first.message) : 'Invalid input',
        details: error.issues,
      });
    }
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.code, message: error.message, details: error.details });
    }
    const sqliteCode = (error as { code?: string }).code;
    if (sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE') {
      return reply.code(409).send({ error: 'duplicate', message: 'An item with this name already exists' });
    }
    if (sqliteCode === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return reply.code(409).send({ error: 'in_use', message: 'This item is still in use' });
    }
    const status = (error as FastifyError).statusCode ?? 500;
    if (status < 500) {
      return reply.code(status).send({ error: (error as FastifyError).code ?? 'error', message: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong. Please try again.' });
  });

  app.get('/api/health', async () => {
    sqlite.prepare('SELECT 1').get();
    return { status: 'ok' };
  });

  authRoutes(app, ctx);
  accountRoutes(app, ctx);
  categoryRoutes(app, ctx);
  recipientRoutes(app, ctx);
  tagRoutes(app, ctx);
  settingsRoutes(app, ctx);

  // Built React app: static files plus a client-side routing fallback to index.html.
  const webDist = config.webDist && existsSync(join(config.webDist, 'index.html')) ? config.webDist : undefined;
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      cacheControl: false,
      setHeaders(res, path) {
        if (path.includes('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    // Client-side routes (no file extension) get index.html; missing files and API paths get 404.
    const isAppRoute = !path.startsWith('/api') && !path.startsWith('/assets/') && !/\.[a-z0-9]+$/i.test(path);
    if (webDist && request.method === 'GET' && isAppRoute) {
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', message: 'Not found' });
  });

  await ensureFirstUser(db, config, app.log);
  return { app, ctx };
}
