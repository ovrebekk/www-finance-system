import type Database from 'better-sqlite3';
import {
  ACCOUNT_TYPES,
  categoryKindsFor,
  type CategoryKind,
  type TransactionType,
  CATEGORY_KINDS,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  type LegacyExportFile,
  type LegacyImportCounts,
  type LegacyImportReport,
  type LegacyImportTable,
} from '@finance/shared';
import { parseCsv } from './csv.js';
import { badRequest } from './errors.js';

export { parseCsv };

/**
 * Imports the CSV folder that the old PersonalFinanceWPF app exports
 * (CsvExporter.cs, format version 1; spec: "Legacy CSV export format" doc).
 *
 * Everything runs in one SQLite transaction: any invalid row rolls the whole
 * import back. Rows keep the old id in legacy_id, so a second run skips what
 * the first one imported. Accounts, recipients and tags with the same name
 * (case-insensitive), and categories with the same kind, parent and name, are
 * merged into one row instead of failing on the unique indexes.
 */

export const KNOWN_FORMAT_VERSIONS = [1];
const MAX_ERRORS = 50;
const DEFAULT_TAG_COLOR = '#64748b';

type Files = Partial<Record<LegacyExportFile, string>>;
type Row = Record<string, string>;

class Problems {
  readonly list: string[] = [];
  add(message: string) {
    if (this.list.length < MAX_ERRORS) this.list.push(message);
  }
  get any() {
    return this.list.length > 0;
  }
}

/** Reads a CSV file into objects keyed by header, checking the columns are there. */
function readTable(files: Files, file: LegacyExportFile, columns: string[], problems: Problems, optional = false): Row[] {
  const text = files[file];
  if (text === undefined) {
    if (!optional) problems.add(`${file} is missing`);
    return [];
  }
  const [header, ...body] = parseCsv(text);
  if (!header) {
    problems.add(`${file} is empty`);
    return [];
  }
  const missing = columns.filter((c) => !header.includes(c));
  if (missing.length) {
    problems.add(`${file} lacks the column(s) ${missing.join(', ')}`);
    return [];
  }
  return body
    .filter((cells) => !(cells.length === 1 && cells[0] === ''))
    .map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])));
}

export function parseSummary(text: string | undefined): { formatVersion: number; exportedAt: string | null; warnings: number } {
  if (text === undefined) throw badRequest('export-summary.txt is missing; choose the whole export folder');
  const version = /^Format version:\s*(\d+)\s*$/m.exec(text);
  if (!version) throw badRequest('export-summary.txt has no "Format version" line');
  const formatVersion = Number(version[1]);
  if (!KNOWN_FORMAT_VERSIONS.includes(formatVersion)) {
    throw badRequest(`Export format version ${formatVersion} is not supported (this app reads version ${KNOWN_FORMAT_VERSIONS.join(', ')})`);
  }
  const exportedAt = /^Exported:\s*(.+?)\s*$/m.exec(text)?.[1] ?? null;
  const warnings = Number(/^Warnings \((\d+)\)/m.exec(text)?.[1] ?? 0);
  return { formatVersion, exportedAt, warnings };
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const isInt = (v: string) => /^-?\d+$/.test(v) && Number.isSafeInteger(Number(v));
const nullable = (v: string) => (v.trim() === '' ? null : v.trim());
const bool = (v: string) => v.trim().toLowerCase() === 'true';

const TABLES: Record<string, string> = { account: 'accounts', category: 'categories', recipient: 'recipients', tag: 'tags' };
const plural = (what: string) => (what.endsWith('y') ? `${what.slice(0, -1)}ies` : `${what}s`);
const emptyCounts = (): LegacyImportCounts => ({ rows: 0, created: 0, merged: 0, skipped: 0 });

class Rollback extends Error {}

export function importLegacyExport(
  sqlite: Database.Database,
  files: Files,
  userId: number,
  { dryRun = false }: { dryRun?: boolean } = {},
): LegacyImportReport {
  const summary = parseSummary(files['export-summary.txt']);
  const problems = new Problems();

  const tables = {
    accounts: readTable(files, 'accounts.csv', ['legacy_id', 'name', 'type', 'opening_balance', 'opening_date', 'archived', 'sort_order', 'notes'], problems),
    categories: readTable(files, 'categories.csv', ['legacy_id', 'name', 'kind', 'parent_legacy_id', 'archived', 'sort_order'], problems),
    recipients: readTable(files, 'recipients.csv', ['legacy_id', 'name', 'default_category_legacy_id', 'notes', 'archived'], problems),
    tags: readTable(files, 'tags.csv', ['legacy_id', 'name', 'color'], problems),
    transactions: readTable(files, 'transactions.csv', ['legacy_id', 'type', 'date', 'amount', 'account_legacy_id', 'to_account_legacy_id', 'recipient_legacy_id', 'description', 'status'], problems),
    lines: readTable(files, 'transaction_lines.csv', ['transaction_legacy_id', 'line_no', 'category_legacy_id', 'amount', 'memo'], problems),
    lineTags: readTable(files, 'transaction_line_tags.csv', ['transaction_legacy_id', 'line_no', 'tag_legacy_id'], problems, true),
  };
  if (problems.any) throw badRequest('The export folder is incomplete', problems.list);

  const counts = Object.fromEntries(
    (Object.keys(tables) as LegacyImportTable[]).map((t) => [t, { ...emptyCounts(), rows: tables[t].length }]),
  ) as Record<LegacyImportTable, LegacyImportCounts>;
  const notes: string[] = [];

  const run = sqlite.transaction(() => {
    const now = new Date().toISOString();
    const audit = { now, userId };

    /** Legacy id → new id, per table. */
    const accountIds = new Map<string, number>();
    const categoryIds = new Map<string, { id: number; kind: string }>();
    const recipientIds = new Map<string, number>();
    const tagIds = new Map<string, number>();

    const seen = (file: string) => {
      const ids = new Set<string>();
      return (legacyId: string, where: string) => {
        if (!legacyId) {
          problems.add(`${where}: legacy_id is empty`);
          return false;
        }
        if (ids.has(legacyId)) {
          problems.add(`${file}: legacy_id ${legacyId} appears more than once`);
          return false;
        }
        ids.add(legacyId);
        return true;
      };
    };

    /** Same-name rows of one file merged into one row, for the notes. */
    const merges = new Map<string, Map<number, number>>();
    /** Rows this run created, so a merge note can tell a same-name group from a row that was already here. */
    const created = new Set<string>();
    const noteCreate = (what: string, id: number) => created.add(`${what}/${id}`);
    const noteMerge = (what: string, id: number) => {
      const byId = merges.get(what) ?? new Map<number, number>();
      byId.set(id, (byId.get(id) ?? 0) + 1);
      merges.set(what, byId);
    };

    /**
     * True when a same-name row was imported from this export by an earlier
     * run (its legacy_id is another row of the same file), so the row counts
     * as skipped rather than merged.
     */
    const fromEarlierRun = (table: string, what: string, id: number, fileIds: Set<string>) => {
      if (created.has(`${what}/${id}`) || merges.get(what)?.has(id)) return false;
      const legacyId = sqlite.prepare(`SELECT legacy_id FROM ${table} WHERE id = ?`).pluck().get(id) as string | null;
      return legacyId !== null && fileIds.has(legacyId);
    };
    const idsOf = (rows: Row[]) => new Set(rows.map((r) => r.legacy_id!.trim()));

    // ---- accounts ----
    {
      const byLegacy = sqlite.prepare('SELECT id FROM accounts WHERE legacy_id = ?').pluck();
      const byName = sqlite.prepare('SELECT id, legacy_id FROM accounts WHERE lower(name) = lower(?)');
      const setLegacy = sqlite.prepare('UPDATE accounts SET legacy_id = ? WHERE id = ? AND legacy_id IS NULL');
      const insert = sqlite.prepare(
        `INSERT INTO accounts (name, type, opening_balance, opening_date, archived, sort_order, notes, legacy_id, created_at, updated_at, created_by, updated_by)
         VALUES (@name, @type, @openingBalance, @openingDate, @archived, @sortOrder, @notes, @legacyId, @now, @now, @userId, @userId)`,
      );
      const check = seen('accounts.csv');
      const fileIds = idsOf(tables.accounts);
      tables.accounts.forEach((r, i) => {
        const where = `accounts.csv row ${i + 2}`;
        if (!check(r.legacy_id!, where)) return;
        const name = r.name!.trim();
        if (!name || name.length > 100) return problems.add(`${where}: name must be 1–100 characters`);
        if (!(ACCOUNT_TYPES as readonly string[]).includes(r.type!)) return problems.add(`${where}: unknown account type '${r.type}'`);
        if (!isInt(r.opening_balance!)) return problems.add(`${where}: opening_balance must be whole øre`);
        if (!isDate(r.opening_date!)) return problems.add(`${where}: opening_date must be YYYY-MM-DD`);
        const existing = byLegacy.get(r.legacy_id) as number | undefined;
        if (existing !== undefined) {
          accountIds.set(r.legacy_id!, existing);
          counts.accounts.skipped++;
          return;
        }
        const same = byName.get(name) as { id: number; legacy_id: string | null } | undefined;
        if (same) {
          accountIds.set(r.legacy_id!, same.id);
          if (fromEarlierRun('accounts', 'account', same.id, fileIds)) counts.accounts.skipped++;
          else {
            setLegacy.run(r.legacy_id, same.id);
            counts.accounts.merged++;
            noteMerge('account', same.id);
          }
          return;
        }
        const { lastInsertRowid } = insert.run({
          name,
          type: r.type,
          openingBalance: Number(r.opening_balance),
          openingDate: r.opening_date,
          archived: bool(r.archived!) ? 1 : 0,
          sortOrder: isInt(r.sort_order!) ? Number(r.sort_order) : 0,
          notes: nullable(r.notes!),
          legacyId: r.legacy_id,
          ...audit,
        });
        accountIds.set(r.legacy_id!, Number(lastInsertRowid));
        noteCreate('account', Number(lastInsertRowid));
        counts.accounts.created++;
      });
    }

    // ---- categories (parents before children; the file is already in that order, but do not rely on it) ----
    {
      const byLegacy = sqlite.prepare('SELECT id, kind FROM categories WHERE legacy_id = ?');
      const byName = sqlite.prepare('SELECT id FROM categories WHERE kind = ? AND coalesce(parent_id, 0) = ? AND lower(name) = lower(?)').pluck();
      const setLegacy = sqlite.prepare('UPDATE categories SET legacy_id = ? WHERE id = ? AND legacy_id IS NULL');
      const insert = sqlite.prepare(
        `INSERT INTO categories (name, kind, parent_id, archived, sort_order, legacy_id, created_at, updated_at, created_by, updated_by)
         VALUES (@name, @kind, @parentId, @archived, @sortOrder, @legacyId, @now, @now, @userId, @userId)`,
      );
      const check = seen('categories.csv');
      let pending = tables.categories
        .map((r, i) => ({ r, where: `categories.csv row ${i + 2}` }))
        .filter(({ r, where }) => {
          if (!check(r.legacy_id!, where)) return false;
          const name = r.name!.trim();
          if (!name || name.length > 100) return problems.add(`${where}: name must be 1–100 characters`), false;
          if (!(CATEGORY_KINDS as readonly string[]).includes(r.kind!)) return problems.add(`${where}: unknown category kind '${r.kind}'`), false;
          return true;
        });
      const legacyInFile = new Set(pending.map(({ r }) => r.legacy_id!));
      while (pending.length) {
        const later: typeof pending = [];
        for (const item of pending) {
          const { r, where } = item;
          const parentLegacy = r.parent_legacy_id!.trim();
          let parentId = 0;
          if (parentLegacy) {
            const parent = categoryIds.get(parentLegacy);
            if (!parent) {
              if (legacyInFile.has(parentLegacy)) later.push(item);
              else problems.add(`${where}: parent_legacy_id ${parentLegacy} is not in categories.csv`);
              continue;
            }
            if (parent.kind !== r.kind) {
              problems.add(`${where}: parent category is ${parent.kind}, this one is ${r.kind}`);
              continue;
            }
            parentId = parent.id;
          }
          const existing = byLegacy.get(r.legacy_id) as { id: number; kind: string } | undefined;
          if (existing) {
            categoryIds.set(r.legacy_id!, existing);
            counts.categories.skipped++;
            continue;
          }
          const name = r.name!.trim();
          const same = byName.get(r.kind, parentId, name) as number | undefined;
          if (same !== undefined) {
            categoryIds.set(r.legacy_id!, { id: same, kind: r.kind! });
            if (fromEarlierRun('categories', 'category', same, legacyInFile)) counts.categories.skipped++;
            else {
              setLegacy.run(r.legacy_id, same);
              counts.categories.merged++;
              noteMerge('category', same);
            }
            continue;
          }
          const { lastInsertRowid } = insert.run({
            name,
            kind: r.kind,
            parentId: parentId || null,
            archived: bool(r.archived!) ? 1 : 0,
            sortOrder: isInt(r.sort_order!) ? Number(r.sort_order) : 0,
            legacyId: r.legacy_id,
            ...audit,
          });
          categoryIds.set(r.legacy_id!, { id: Number(lastInsertRowid), kind: r.kind! });
          noteCreate('category', Number(lastInsertRowid));
          counts.categories.created++;
        }
        if (later.length === pending.length) {
          for (const { where } of later) problems.add(`${where}: its parent chain loops back on itself`);
          break;
        }
        pending = later;
      }
    }

    // ---- recipients ----
    {
      const byLegacy = sqlite.prepare('SELECT id FROM recipients WHERE legacy_id = ?').pluck();
      const byName = sqlite.prepare('SELECT id FROM recipients WHERE lower(name) = lower(?)').pluck();
      const setLegacy = sqlite.prepare('UPDATE recipients SET legacy_id = ? WHERE id = ? AND legacy_id IS NULL');
      const insert = sqlite.prepare(
        `INSERT INTO recipients (name, default_category_id, notes, archived, legacy_id, created_at, updated_at, created_by, updated_by)
         VALUES (@name, @defaultCategoryId, @notes, @archived, @legacyId, @now, @now, @userId, @userId)`,
      );
      const check = seen('recipients.csv');
      const fileIds = idsOf(tables.recipients);
      tables.recipients.forEach((r, i) => {
        const where = `recipients.csv row ${i + 2}`;
        if (!check(r.legacy_id!, where)) return;
        const name = r.name!.trim();
        if (!name || name.length > 100) return problems.add(`${where}: name must be 1–100 characters`);
        const categoryLegacy = r.default_category_legacy_id!.trim();
        const category = categoryLegacy ? categoryIds.get(categoryLegacy) : undefined;
        if (categoryLegacy && !category) return problems.add(`${where}: default_category_legacy_id ${categoryLegacy} is not in categories.csv`);
        const existing = byLegacy.get(r.legacy_id) as number | undefined;
        if (existing !== undefined) {
          recipientIds.set(r.legacy_id!, existing);
          counts.recipients.skipped++;
          return;
        }
        const same = byName.get(name) as number | undefined;
        if (same !== undefined) {
          recipientIds.set(r.legacy_id!, same);
          if (fromEarlierRun('recipients', 'recipient', same, fileIds)) counts.recipients.skipped++;
          else {
            setLegacy.run(r.legacy_id, same);
            counts.recipients.merged++;
            noteMerge('recipient', same);
          }
          return;
        }
        const { lastInsertRowid } = insert.run({
          name,
          defaultCategoryId: category?.id ?? null,
          notes: nullable(r.notes!),
          archived: bool(r.archived!) ? 1 : 0,
          legacyId: r.legacy_id,
          ...audit,
        });
        recipientIds.set(r.legacy_id!, Number(lastInsertRowid));
        noteCreate('recipient', Number(lastInsertRowid));
        counts.recipients.created++;
      });
    }

    // ---- tags ----
    {
      const byLegacy = sqlite.prepare('SELECT id FROM tags WHERE legacy_id = ?').pluck();
      const byName = sqlite.prepare('SELECT id FROM tags WHERE lower(name) = lower(?)').pluck();
      const setLegacy = sqlite.prepare('UPDATE tags SET legacy_id = ? WHERE id = ? AND legacy_id IS NULL');
      const insert = sqlite.prepare(
        `INSERT INTO tags (name, color, legacy_id, created_at, updated_at, created_by, updated_by)
         VALUES (@name, @color, @legacyId, @now, @now, @userId, @userId)`,
      );
      const check = seen('tags.csv');
      const fileIds = idsOf(tables.tags);
      let withParent = 0;
      tables.tags.forEach((r, i) => {
        const where = `tags.csv row ${i + 2}`;
        if (!check(r.legacy_id!, where)) return;
        const name = r.name!.trim();
        if (!name || name.length > 100) return problems.add(`${where}: name must be 1–100 characters`);
        const color = r.color!.trim() || DEFAULT_TAG_COLOR;
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return problems.add(`${where}: color '${color}' is not #rrggbb`);
        if (r.legacy_parent_id?.trim()) withParent++;
        const existing = byLegacy.get(r.legacy_id) as number | undefined;
        if (existing !== undefined) {
          tagIds.set(r.legacy_id!, existing);
          counts.tags.skipped++;
          return;
        }
        const same = byName.get(name) as number | undefined;
        if (same !== undefined) {
          tagIds.set(r.legacy_id!, same);
          if (fromEarlierRun('tags', 'tag', same, fileIds)) counts.tags.skipped++;
          else {
            setLegacy.run(r.legacy_id, same);
            counts.tags.merged++;
            noteMerge('tag', same);
          }
          return;
        }
        const { lastInsertRowid } = insert.run({ name, color, legacyId: r.legacy_id, ...audit });
        tagIds.set(r.legacy_id!, Number(lastInsertRowid));
        noteCreate('tag', Number(lastInsertRowid));
        counts.tags.created++;
      });
      if (withParent) notes.push(`${withParent} tag(s) had a parent tag in the old app; tags are flat here, so the parent was dropped.`);
    }

    // ---- transactions, lines and line tags ----
    {
      const linesByTx = new Map<string, { r: Row; where: string }[]>();
      tables.lines.forEach((r, i) => {
        const key = r.transaction_legacy_id!.trim();
        linesByTx.set(key, [...(linesByTx.get(key) ?? []), { r, where: `transaction_lines.csv row ${i + 2}` }]);
      });
      const txLegacyIds = new Set(tables.transactions.map((r) => r.legacy_id!.trim()));
      for (const [key, lines] of linesByTx) {
        if (!txLegacyIds.has(key)) problems.add(`${lines[0]!.where}: transaction_legacy_id ${key} is not in transactions.csv`);
      }

      const byLegacy = sqlite.prepare('SELECT id FROM transactions WHERE legacy_id = ?').pluck();
      const insertTx = sqlite.prepare(
        `INSERT INTO transactions (type, date, amount, account_id, to_account_id, recipient_id, description, status, legacy_id, created_at, updated_at, created_by, updated_by)
         VALUES (@type, @date, @amount, @accountId, @toAccountId, @recipientId, @description, @status, @legacyId, @now, @now, @userId, @userId)`,
      );
      const insertLine = sqlite.prepare(
        'INSERT INTO transaction_lines (transaction_id, category_id, amount, memo, sort_order) VALUES (?, ?, ?, ?, ?)',
      );
      /** "<transaction legacy id>/<line_no>" → new line id, for line tags. */
      const lineIds = new Map<string, number>();
      const skippedTx = new Set<string>();
      const check = seen('transactions.csv');

      tables.transactions.forEach((r, i) => {
        const where = `transactions.csv row ${i + 2} (legacy id ${r.legacy_id})`;
        const legacyId = r.legacy_id!.trim();
        if (!check(legacyId, where)) return;
        const type = r.type!;
        const lines = linesByTx.get(legacyId) ?? [];
        if (!(TRANSACTION_TYPES as readonly string[]).includes(type)) return problems.add(`${where}: unknown type '${type}'`);
        if (!isDate(r.date!)) return problems.add(`${where}: date must be YYYY-MM-DD`);
        if (!isInt(r.amount!) || Number(r.amount) <= 0) return problems.add(`${where}: amount must be whole øre above 0`);
        const status = r.status!.trim() || 'cleared';
        if (!(TRANSACTION_STATUSES as readonly string[]).includes(status)) return problems.add(`${where}: unknown status '${status}'`);
        const accountId = accountIds.get(r.account_legacy_id!.trim());
        if (accountId === undefined) return problems.add(`${where}: account_legacy_id ${r.account_legacy_id} is not in accounts.csv`);
        const recipientLegacy = r.recipient_legacy_id!.trim();
        const recipientId = recipientLegacy ? recipientIds.get(recipientLegacy) : null;
        if (recipientId === undefined) return problems.add(`${where}: recipient_legacy_id ${recipientLegacy} is not in recipients.csv`);

        let toAccountId: number | null = null;
        const amount = Number(r.amount);
        const parsedLines: { categoryId: number | null; amount: number; memo: string | null; lineNo: string }[] = [];
        if (type === 'transfer') {
          const toLegacy = r.to_account_legacy_id!.trim();
          if (!toLegacy) return problems.add(`${where}: a transfer needs to_account_legacy_id`);
          toAccountId = accountIds.get(toLegacy) ?? null;
          if (toAccountId === null) return problems.add(`${where}: to_account_legacy_id ${toLegacy} is not in accounts.csv`);
          if (toAccountId === accountId) return problems.add(`${where}: a transfer must go to another account`);
          if (lines.length) return problems.add(`${where}: a transfer has no lines, but transaction_lines.csv has ${lines.length}`);
        } else {
          if (r.to_account_legacy_id!.trim()) return problems.add(`${where}: only transfers have to_account_legacy_id`);
          if (!lines.length) return problems.add(`${where}: ${type} has no lines in transaction_lines.csv`);
          const lineNos = new Set<string>();
          for (const { r: l, where: lw } of lines) {
            const lineNo = l.line_no!.trim();
            if (!isInt(lineNo)) return problems.add(`${lw}: line_no must be a number`);
            if (lineNos.has(lineNo)) return problems.add(`${lw}: line_no ${lineNo} appears twice for transaction ${legacyId}`);
            lineNos.add(lineNo);
            if (!isInt(l.amount!) || Number(l.amount) <= 0) return problems.add(`${lw}: amount must be whole øre above 0`);
            const catLegacy = l.category_legacy_id!.trim();
            let categoryId: number | null = null;
            if (catLegacy) {
              const cat = categoryIds.get(catLegacy);
              if (!cat) return problems.add(`${lw}: category_legacy_id ${catLegacy} is not in categories.csv`);
              if (!categoryKindsFor(type as TransactionType).includes(cat.kind as CategoryKind)) return problems.add(`${lw}: ${cat.kind} category on ${type} transaction ${legacyId}`);
              categoryId = cat.id;
            }
            parsedLines.push({ categoryId, amount: Number(l.amount), memo: nullable(l.memo!), lineNo });
          }
          const sum = parsedLines.reduce((s, l) => s + l.amount, 0);
          if (sum !== amount) return problems.add(`${where}: amount ${amount} is not the sum of its lines (${sum})`);
          parsedLines.sort((a, b) => Number(a.lineNo) - Number(b.lineNo));
        }

        if (byLegacy.get(legacyId) !== undefined) {
          skippedTx.add(legacyId);
          counts.transactions.skipped++;
          counts.lines.skipped += parsedLines.length;
          return;
        }
        const { lastInsertRowid } = insertTx.run({
          type,
          date: r.date,
          amount,
          accountId,
          toAccountId,
          recipientId,
          description: nullable(r.description!),
          status,
          legacyId,
          ...audit,
        });
        const txId = Number(lastInsertRowid);
        counts.transactions.created++;
        parsedLines.forEach((l, n) => {
          const line = insertLine.run(txId, l.categoryId, l.amount, l.memo, n);
          lineIds.set(`${legacyId}/${l.lineNo}`, Number(line.lastInsertRowid));
          counts.lines.created++;
        });
      });

      const insertLineTag = sqlite.prepare('INSERT OR IGNORE INTO transaction_line_tags (line_id, tag_id) VALUES (?, ?)');
      tables.lineTags.forEach((r, i) => {
        const where = `transaction_line_tags.csv row ${i + 2}`;
        const txLegacy = r.transaction_legacy_id!.trim();
        const tagId = tagIds.get(r.tag_legacy_id!.trim());
        if (tagId === undefined) return problems.add(`${where}: tag_legacy_id ${r.tag_legacy_id} is not in tags.csv`);
        if (skippedTx.has(txLegacy)) {
          counts.lineTags.skipped++;
          return;
        }
        const lineId = lineIds.get(`${txLegacy}/${r.line_no!.trim()}`);
        if (lineId === undefined) return problems.add(`${where}: no line ${r.line_no} on transaction ${txLegacy}`);
        if (insertLineTag.run(lineId, tagId).changes) counts.lineTags.created++;
        else counts.lineTags.merged++;
      });
    }

    for (const [what, byId] of merges) {
      for (const [id, n] of byId) {
        const name = sqlite.prepare(`SELECT name FROM ${TABLES[what]} WHERE id = ?`).pluck().get(id) as string;
        notes.push(
          created.has(`${what}/${id}`)
            ? `${n + 1} old ${plural(what)} named '${name}' were merged into one.`
            : `${n} old ${n === 1 ? what : plural(what)} named '${name}' merged into the existing ${what}.`,
        );
      }
    }

    if (problems.any) throw badRequest('The export has rows this app cannot import; nothing was imported', problems.list);
    if (dryRun) throw new Rollback();
  });

  try {
    run.immediate();
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return { dryRun, formatVersion: summary.formatVersion, exportedAt: summary.exportedAt, exportWarnings: summary.warnings, counts, notes };
}
