import type Database from 'better-sqlite3';
import { descendantIds, type Transaction, type TransactionFilter, type TransactionLine } from '@finance/shared';
import { notFound } from './errors.js';

interface TransactionRow extends Omit<Transaction, 'lines'> {}
interface LineRow extends Omit<TransactionLine, 'tagIds'> {
  transactionId: number;
}

const TRANSACTION_COLUMNS = `
  t.id, t.type, t.date, t.amount, t.account_id AS accountId, t.to_account_id AS toAccountId,
  t.recipient_id AS recipientId, t.description, t.status, t.client_id AS clientId,
  t.created_at AS createdAt, t.updated_at AS updatedAt`;

/** Reads transactions with their lines and tags; keeps the order of `ids`. */
export function loadTransactions(sqlite: Database.Database, ids: number[]): Transaction[] {
  if (ids.length === 0) return [];
  const json = JSON.stringify(ids);
  const rows = sqlite
    .prepare(`SELECT ${TRANSACTION_COLUMNS} FROM transactions t WHERE t.id IN (SELECT value FROM json_each(?))`)
    .all(json) as TransactionRow[];
  const lines = sqlite
    .prepare(
      `SELECT l.id, l.transaction_id AS transactionId, l.category_id AS categoryId, l.amount, l.memo
       FROM transaction_lines l WHERE l.transaction_id IN (SELECT value FROM json_each(?))
       ORDER BY l.sort_order, l.id`,
    )
    .all(json) as LineRow[];
  const tags = sqlite
    .prepare(
      `SELECT lt.line_id AS lineId, lt.tag_id AS tagId FROM transaction_line_tags lt
       JOIN transaction_lines l ON l.id = lt.line_id
       WHERE l.transaction_id IN (SELECT value FROM json_each(?)) ORDER BY lt.tag_id`,
    )
    .all(json) as { lineId: number; tagId: number }[];

  const tagsByLine = new Map<number, number[]>();
  for (const t of tags) tagsByLine.set(t.lineId, [...(tagsByLine.get(t.lineId) ?? []), t.tagId]);
  const linesByTransaction = new Map<number, TransactionLine[]>();
  for (const { transactionId, ...line } of lines) {
    const list = linesByTransaction.get(transactionId) ?? [];
    list.push({ ...line, tagIds: tagsByLine.get(line.id) ?? [] });
    linesByTransaction.set(transactionId, list);
  }
  const byId = new Map(rows.map((r) => [r.id, { ...r, lines: linesByTransaction.get(r.id) ?? [] }]));
  return ids.map((id) => byId.get(id)).filter((t): t is Transaction => t !== undefined);
}

export function loadTransaction(sqlite: Database.Database, id: number): Transaction {
  const [t] = loadTransactions(sqlite, [id]);
  if (!t) throw notFound('Transaction');
  return t;
}

export interface FilterSql {
  /** Conditions on `transactions t`, including an EXISTS for the line conditions. */
  where: string;
  params: unknown[];
  /** Conditions on `transactions t` alone (no line conditions). */
  transactionWhere: string;
  transactionParams: unknown[];
  /** Conditions on `transaction_lines l`; '1' when there are none. */
  lineWhere: string;
  lineParams: unknown[];
}

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Turns a filter into SQL. Category and tag filters apply to lines: a
 * transaction matches when at least one of its lines does, and totals only
 * count the matching lines.
 */
export function filterToSql(sqlite: Database.Database, f: TransactionFilter): FilterSql {
  const tx: string[] = [];
  const txParams: unknown[] = [];
  const line: string[] = [];
  const lineParams: unknown[] = [];
  const add = (condition: string, ...params: unknown[]) => {
    tx.push(condition);
    txParams.push(...params);
  };

  if (f.from) add('t.date >= ?', f.from);
  if (f.to) add('t.date <= ?', f.to);
  if (f.accountId) add('(t.account_id = ? OR t.to_account_id = ?)', f.accountId, f.accountId);
  if (f.recipientId) add('t.recipient_id = ?', f.recipientId);
  if (f.type) add('t.type = ?', f.type);
  if (f.status) add('t.status = ?', f.status);
  if (f.minAmount !== undefined) add('t.amount >= ?', f.minAmount);
  if (f.maxAmount !== undefined) add('t.amount <= ?', f.maxAmount);
  if (f.q) {
    const like = likePattern(f.q);
    tx.push(`(t.description LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM recipients r WHERE r.id = t.recipient_id AND r.name LIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM transaction_lines lq WHERE lq.transaction_id = t.id AND lq.memo LIKE ? ESCAPE '\\'))`);
    txParams.push(like, like, like);
  }

  if (f.uncategorized) {
    line.push('l.category_id IS NULL');
  } else if (f.categoryId) {
    const all = sqlite.prepare('SELECT id, parent_id AS parentId FROM categories').all() as { id: number; parentId: number | null }[];
    line.push('l.category_id IN (SELECT value FROM json_each(?))');
    lineParams.push(JSON.stringify([...descendantIds(all, f.categoryId)]));
  }
  if (f.tagId) {
    line.push('EXISTS (SELECT 1 FROM transaction_line_tags lt WHERE lt.line_id = l.id AND lt.tag_id = ?)');
    lineParams.push(f.tagId);
  }

  const transactionWhere = tx.length ? tx.join(' AND ') : '1';
  const lineWhere = line.length ? line.join(' AND ') : '1';
  const where = line.length
    ? `${transactionWhere} AND EXISTS (SELECT 1 FROM transaction_lines l WHERE l.transaction_id = t.id AND ${lineWhere})`
    : transactionWhere;
  return {
    where,
    params: line.length ? [...txParams, ...lineParams] : txParams,
    transactionWhere,
    transactionParams: txParams,
    lineWhere,
    lineParams,
  };
}

/** Income and expense of the lines matching a filter. */
export function filterTotals(sqlite: Database.Database, sql: FilterSql) {
  const row = sqlite
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN t.type = 'income' THEN l.amount END), 0) AS income,
              COALESCE(SUM(CASE WHEN t.type = 'expense' THEN l.amount END), 0) AS expense
       FROM transactions t JOIN transaction_lines l ON l.transaction_id = t.id
       WHERE ${sql.transactionWhere} AND ${sql.lineWhere}`,
    )
    .get(...sql.transactionParams, ...sql.lineParams) as { income: number; expense: number };
  return { ...row, net: row.income - row.expense };
}
