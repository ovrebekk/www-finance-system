import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp, type BuiltApp } from '../app.js';
import { loadConfig } from '../lib/config.js';

export const ADMIN = { email: 'owner@example.com', password: 'correct horse battery' };

export async function buildTestApp(overrides: Record<string, string> = {}): Promise<BuiltApp> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_FILE: ':memory:',
    DATA_DIR: '/tmp/finance-test',
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_PASSWORD: ADMIN.password,
    ADMIN_NAME: 'Test Owner',
    WEB_DIST: '/nonexistent',
    LOGIN_RATE_LIMIT: '1000',
    ...overrides,
  });
  return buildApp(config);
}

export function cookieFrom(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first) throw new Error('No session cookie set');
  return first.split(';')[0]!;
}

export async function login(app: FastifyInstance, creds = ADMIN): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: creds });
  if (res.statusCode !== 200) throw new Error(`Login failed: ${res.statusCode} ${res.body}`);
  return cookieFrom(res);
}

/** Small client bound to a session cookie. */
export function client(app: FastifyInstance, cookie: string) {
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE') => (url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as never, headers: { cookie } });
  return { get: call('GET'), post: call('POST'), patch: call('PATCH'), del: call('DELETE') };
}
