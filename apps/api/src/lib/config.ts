import { resolve } from 'node:path';

export interface Config {
  env: 'production' | 'development' | 'test';
  isProduction: boolean;
  host: string;
  port: number;
  dataDir: string;
  dbFile: string;
  sessionSecret: string;
  adminEmail: string | undefined;
  adminPassword: string | undefined;
  adminName: string;
  backupsEnabled: boolean;
  backupKeep: number;
  /** Folder with the built web app; served when it exists. */
  webDist: string | undefined;
  /** Login attempts per minute per IP. */
  loginRateLimit: number;
  logLevel: string;
}

const DEV_SECRET = 'development-only-secret-do-not-use-in-production!!';

export class ConfigError extends Error {}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { requireSessionSecret?: boolean } = {},
): Config {
  const mode = env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  const isProduction = mode === 'production';
  const requireSecret = options.requireSessionSecret ?? true;

  let sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    if (isProduction && requireSecret) {
      throw new ConfigError(
        'SESSION_SECRET must be set to at least 32 characters in production. Generate one with: openssl rand -hex 32',
      );
    }
    sessionSecret = DEV_SECRET;
  }

  const dataDir = resolve(env.DATA_DIR ?? (isProduction ? '/app/data' : './data'));
  const int = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return value !== undefined && value !== '' && Number.isInteger(n) ? n : fallback;
  };

  return {
    env: mode,
    isProduction,
    host: env.HOST ?? (isProduction ? '0.0.0.0' : '127.0.0.1'),
    port: int(env.PORT, 3000),
    dataDir,
    dbFile: env.DB_FILE ?? resolve(dataDir, 'finance.sqlite'),
    sessionSecret,
    adminEmail: env.ADMIN_EMAIL?.trim().toLowerCase() || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
    adminName: env.ADMIN_NAME?.trim() || 'Owner',
    backupsEnabled: env.BACKUPS_ENABLED ? env.BACKUPS_ENABLED === 'true' : isProduction,
    backupKeep: Math.max(1, int(env.BACKUP_KEEP, 30)),
    webDist: env.WEB_DIST ?? resolve(import.meta.dirname, '../../../web/dist'),
    loginRateLimit: int(env.LOGIN_RATE_LIMIT, 5),
    logLevel: env.LOG_LEVEL ?? (mode === 'test' ? 'silent' : 'info'),
  };
}
