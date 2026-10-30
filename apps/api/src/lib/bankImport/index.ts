import type Database from 'better-sqlite3';
import {
  categoryKindsFor,
  transactionInputSchema,
  type CategoryKind,
  type BankFormat,
  type BankImportPreview,
  type BankImportResult,
  type BankImportRow,
  type TransactionType,
} from '@finance/shared';
import { nowIso } from '../context.js';
import { badRequest, HttpError } from '../errors.js';
import { transactionWriter, type TransactionWrite } from '../transactions.js';
import { accountDigits, type ParsedBankRow } from './format.js';
import { detectFormat, FORMATS } from './formats.js';

const MAX_PROBLEMS = 50;

/** The most common own account number in the rows, else one in the file name ("Brukskonto 6580.70.56411 - …"). */
function accountNumberOf(rows: ParsedBankRow[], fileName: string | null): string | null {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.ownAccountNumber) counts.set(r.ownAccountNumber, (counts.get(r.ownAccountNumber) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ?? /\b\d{4}\.\d{2}\.\d{5}\b|\b\d{11}\b/.exec(fileName ?? '')?.[0] ?? null;
}

/**
 * Reads a bank's CSV export and suggests a transaction for each row:
 * the type from the sign (or a transfer when the other account number is one
 * of ours), the recipient by name, the category from the recipient's default
 * or last-used category, and flags rows that are already on the account.
 * Nothing is written.
 */
export function previewBankImport(
  sqlite: Database.Database,
  input: { content: string; fileName: string | null; format?: BankFormat; accountId?: number },
): BankImportPreview {
  const detected = detectFormat(input.content, input.format);
  if (!detected) {
    const known = Object.values(FORMATS).map((f) => f.label).join(', ');
    throw badRequest(
      input.format
        ? `This is not a ${FORMATS[input.format].label} export`
        : `The file is not in a bank format this app knows (it reads ${known})`,
    );
  }
  const { format, header, table } = detected;
  const problems: string[] = [];
  const body = table
    .map((cells, i) => ({ line: i + 1, cells }))
    .slice(1)
    .filter(({ cells }) => !cells.every((c) => c.trim() === ''));
  const parsed = format.parse(header, body, problems);

  const accounts = sqlite.prepare('SELECT id, name, notes FROM accounts').all() as { id: number; name: string; notes: string | null }[];
  /** Accounts carry no number field, so a number written in the name or notes identifies one. */
  const accountByNumber = (number: string | null) => {
    const digits = accountDigits(number);
    if (digits.length < 6) return null;
    return accounts.find((a) => accountDigits(`${a.name} ${a.notes ?? ''}`).includes(digits))?.id ?? null;
  };

  const accountNumber = accountNumberOf(parsed, input.fileName);
  let accountId: number | null = input.accountId ?? accountByNumber(accountNumber);
  if (input.accountId !== undefined && !accounts.some((a) => a.id === input.accountId)) throw badRequest('Account not found');

  const recipientByName = sqlite.prepare(
    `SELECT r.id, r.name, r.default_category_id AS defaultCategoryId, c.kind AS defaultKind
     FROM recipients r LEFT JOIN categories c ON c.id = r.default_category_id WHERE lower(r.name) = lower(?)`,
  );
  const lastCategory = sqlite
    .prepare(
      `SELECT l.category_id FROM transactions t JOIN transaction_lines l ON l.transaction_id = t.id
       JOIN categories c ON c.id = l.category_id
       WHERE t.recipient_id = ? AND t.type = ? AND c.archived = 0 ORDER BY t.date DESC, t.id DESC LIMIT 1`,
    )
    .pluck();
  const moneyOut = sqlite
    .prepare(
      `SELECT id FROM transactions WHERE date = ? AND amount = ?
         AND ((type = 'expense' AND account_id = @a) OR (type = 'transfer' AND account_id = @a)) ORDER BY id`,
    )
    .pluck();
  const moneyIn = sqlite
    .prepare(
      `SELECT id FROM transactions WHERE date = ? AND amount = ?
         AND ((type = 'income' AND account_id = @a) OR (type = 'transfer' AND to_account_id = @a)) ORDER BY id`,
    )
    .pluck();
  /** Each existing transaction can only be the duplicate of one row, so two equal rows need two matches. */
  const matched = new Set<number>();

  const rows: BankImportRow[] = parsed.map((r) => {
    const warnings: string[] = [];
    if (r.reserved) warnings.push('Reserved: the bank has not booked this yet, so it has no date');
    if (r.currency !== 'NOK') warnings.push(`The amount is in ${r.currency}; it is imported as NOK`);

    const otherAccountId = accountByNumber(r.otherAccountNumber);
    let type: TransactionType = r.amount < 0 ? 'expense' : 'income';
    if (otherAccountId !== null && otherAccountId !== accountId) type = 'transfer';
    else if (r.looksLikeTransfer) warnings.push(`${format.label} marks this as a transfer; choose Transfer if it went to one of your accounts`);

    let recipientId: number | null = null;
    let recipientName: string | null = r.counterparty;
    let categoryId: number | null = null;
    if (type !== 'transfer' && r.counterparty) {
      const found = recipientByName.get(r.counterparty) as
        | { id: number; name: string; defaultCategoryId: number | null; defaultKind: string | null }
        | undefined;
      if (found) {
        recipientId = found.id;
        recipientName = found.name;
        categoryId =
          found.defaultCategoryId !== null && categoryKindsFor(type).includes(found.defaultKind as CategoryKind)
            ? found.defaultCategoryId
            : ((lastCategory.get(found.id, type) as number | undefined) ?? null);
      }
    }
    if (type === 'transfer') recipientName = null;

    let duplicateOf: number | null = null;
    if (accountId !== null && r.date) {
      const candidates = (r.amount < 0 ? moneyOut : moneyIn).all(r.date, Math.abs(r.amount), { a: accountId }) as number[];
      duplicateOf = candidates.find((id) => !matched.has(id)) ?? null;
      if (duplicateOf !== null) matched.add(duplicateOf);
    }

    return {
      line: r.line,
      date: r.date,
      amount: r.amount,
      currency: r.currency,
      counterparty: r.counterparty,
      text: r.text,
      bankType: r.bankType,
      otherAccountNumber: r.otherAccountNumber,
      reserved: r.reserved,
      suggestion: {
        type,
        recipientId,
        recipientName,
        categoryId,
        otherAccountId: type === 'transfer' ? otherAccountId : null,
        description: type === 'transfer' ? r.counterparty ?? r.text : r.text,
      },
      duplicateOf,
      warnings,
    };
  });

  if (rows.length === 0 && problems.length === 0) problems.push('The file has no transactions');
  return {
    format: format.id,
    formatLabel: format.label,
    accountNumber,
    accountId,
    rows,
    problems: problems.slice(0, MAX_PROBLEMS),
  };
}

/**
 * Saves reviewed rows as transactions, all in one SQLite transaction: one bad
 * row saves nothing. Rows carry a clientId, so sending the same rows again
 * (a retry after a lost response) does not create duplicates.
 */
export function commitBankImport(
  sqlite: Database.Database,
  rows: { line: number; transaction: unknown }[],
  userId: number,
  { saveRecipientDefaults }: { saveRecipientDefaults: boolean },
): BankImportResult {
  const problems: string[] = [];
  const inputs: { line: number; input: TransactionWrite }[] = [];
  for (const row of rows) {
    const parsed = transactionInputSchema.safeParse(row.transaction);
    if (parsed.success) inputs.push({ line: row.line, input: parsed.data });
    else {
      const issue = parsed.error.issues[0]!;
      const field = issue.path.join('.');
      if (problems.length < MAX_PROBLEMS) problems.push(`Line ${row.line}: ${field ? `${field}: ` : ''}${issue.message}`);
    }
  }
  if (problems.length) throw badRequest('Some rows are not valid; nothing was imported', problems);

  const writer = transactionWriter(sqlite);
  const countRecipients = sqlite.prepare('SELECT COUNT(*) FROM recipients').pluck();
  const recipientOf = sqlite.prepare('SELECT recipient_id FROM transactions WHERE id = ?').pluck();
  const setDefault = sqlite.prepare(
    'UPDATE recipients SET default_category_id = ?, updated_at = ?, updated_by = ? WHERE id = ? AND default_category_id IS NULL',
  );

  return sqlite.transaction(() => {
    const recipientsBefore = countRecipients.get() as number;
    const ids: number[] = [];
    let created = 0;
    let defaultsSaved = 0;
    const now = nowIso();
    for (const { line, input } of inputs) {
      const existing = writer.findByClientId(input.clientId);
      if (existing !== undefined) {
        ids.push(existing);
        continue;
      }
      let id: number;
      try {
        id = writer.create(input, userId);
      } catch (err) {
        if (err instanceof HttpError) throw badRequest(`Line ${line}: ${err.message}; nothing was imported`, [`Line ${line}: ${err.message}`]);
        throw err;
      }
      ids.push(id);
      created++;
      const categoryId = input.lines[0]?.categoryId ?? null;
      if (saveRecipientDefaults && input.type !== 'transfer' && input.lines.length === 1 && categoryId !== null) {
        const recipientId = recipientOf.get(id) as number | null;
        if (recipientId !== null) defaultsSaved += setDefault.run(categoryId, now, userId, recipientId).changes;
      }
    }
    return { created, ids, recipientsCreated: (countRecipients.get() as number) - recipientsBefore, defaultsSaved };
  })();
}
