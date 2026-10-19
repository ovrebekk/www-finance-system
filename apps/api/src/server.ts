import { join } from 'node:path';
import { buildApp } from './app.js';
import { runBackup, scheduleDaily } from './lib/backup.js';
import { ConfigError, loadConfig } from './lib/config.js';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const { app, ctx } = await buildApp(config);

  if (config.backupsEnabled) {
    const dir = join(config.dataDir, 'backups');
    scheduleDaily(3, () => {
      try {
        const file = runBackup(ctx.sqlite, dir, config.backupKeep);
        app.log.info({ file }, 'Nightly backup written');
      } catch (err) {
        app.log.error(err, 'Nightly backup failed');
      }
    });
    app.log.info({ dir, keep: config.backupKeep }, 'Nightly backups at 03:00 enabled');
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info(`Received ${signal}, shutting down`);
      void app.close().then(() => process.exit(0));
    });
  }

  await app.listen({ host: config.host, port: config.port });
}

void main();
