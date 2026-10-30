import type { FastifyInstance } from 'fastify';
import { bankImportCommitSchema, bankImportPreviewSchema, legacyImportInputSchema } from '@finance/shared';
import { currentUser } from '../lib/auth.js';
import type { AppContext } from '../lib/context.js';
import { commitBankImport, previewBankImport } from '../lib/bankImport/index.js';
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

  /** Reads a bank's CSV export into suggested transactions for review. Saves nothing. */
  app.post('/api/v1/import/bank/preview', { preHandler: guards.requirePermission('transactions:write') }, async (req) => {
    const input = bankImportPreviewSchema.parse(req.body);
    return previewBankImport(sqlite, input);
  });

  /** Saves the reviewed rows of a bank import, all or nothing. */
  app.post('/api/v1/import/bank/commit', { preHandler: guards.requirePermission('transactions:write') }, async (req, reply) => {
    const { rows, saveRecipientDefaults } = bankImportCommitSchema.parse(req.body);
    const result = commitBankImport(sqlite, rows, currentUser(req).id, { saveRecipientDefaults });
    req.log.info({ created: result.created }, 'bank import done');
    reply.code(201);
    return result;
  });
}
