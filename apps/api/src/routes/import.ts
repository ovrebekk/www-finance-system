import type { FastifyInstance } from 'fastify';
import { legacyImportInputSchema } from '@finance/shared';
import { currentUser } from '../lib/auth.js';
import type { AppContext } from '../lib/context.js';
import { importLegacyExport } from '../lib/legacyImport.js';

export function importRoutes(app: FastifyInstance, ctx: AppContext) {
  const { sqlite, guards } = ctx;

  /**
   * Imports the CSV export folder of the old PersonalFinanceWPF app, sent as
   * file contents by name. With `dryRun` it only checks and counts.
   */
  app.post('/api/v1/import/legacy', { preHandler: guards.requirePermission('settings:admin') }, async (req) => {
    const { files, dryRun } = legacyImportInputSchema.parse(req.body);
    const report = importLegacyExport(sqlite, files, currentUser(req).id, { dryRun });
    if (!dryRun) req.log.info({ counts: report.counts }, 'legacy import done');
    return report;
  });
}
