import type { AccountType, BankFormat, CategoryKind, TransactionFilter, TransactionStatus, TransactionType } from './schemas.js';
import type { Permission } from './permissions.js';

export interface Me {
  id: number;
  name: string;
  email: string;
  role: string;
  permissions: Permission[];
}

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  openingBalance: number;
  openingDate: string;
  archived: boolean;
  sortOrder: number;
  notes: string | null;
  /** Current balance in øre (opening balance + all transactions). */
  balance: number;
  transactionCount: number;
}

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  parentId: number | null;
  archived: boolean;
  sortOrder: number;
  /** Number of transaction lines using this category directly. */
  usageCount: number;
}

export interface Recipient {
  id: number;
  name: string;
  defaultCategoryId: number | null;
  notes: string | null;
  archived: boolean;
  transactionCount: number;
  /** Sum of expense amounts minus income amounts, in øre. */
  total: number;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  usageCount: number;
}

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export interface TransactionLine {
  id: number;
  categoryId: number | null;
  /** øre, > 0 */
  amount: number;
  memo: string | null;
  tagIds: number[];
}

export interface Transaction {
  id: number;
  type: TransactionType;
  date: string;
  /** øre, > 0; the sign follows from the type. */
  amount: number;
  accountId: number;
  toAccountId: number | null;
  recipientId: number | null;
  description: string | null;
  status: TransactionStatus;
  clientId: string | null;
  lines: TransactionLine[];
  createdAt: string;
  updatedAt: string;
}

export interface TransactionPage {
  items: Transaction[];
  /** Number of matching transactions. */
  count: number;
  /** Income minus expense of the matching lines, in øre (transfers count as 0). */
  net: number;
  income: number;
  expense: number;
}

export interface SavedFilter {
  id: number;
  name: string;
  filter: TransactionFilter;
}

export interface CategoryTotal {
  /** Top-level category, or null for uncategorised lines. */
  categoryId: number | null;
  amount: number;
}

export interface MonthSummary {
  month: string;
  income: number;
  expense: number;
  net: number;
}

export interface Dashboard {
  month: string;
  current: MonthSummary;
  previous: MonthSummary;
  /** Expense per top-level category this month, less income booked to expense categories (refunds); largest first. */
  expenseByCategory: CategoryTotal[];
  /** Last six months, oldest first, including this one. */
  trend: MonthSummary[];
  recent: Transaction[];
}

export type LegacyImportTable = 'accounts' | 'categories' | 'recipients' | 'tags' | 'transactions' | 'lines' | 'lineTags';

export interface LegacyImportCounts {
  /** Rows in the file. */
  rows: number;
  /** New rows written. */
  created: number;
  /** Rows mapped onto an existing row with the same name (accounts, categories, recipients, tags). */
  merged: number;
  /** Rows whose legacy id was already imported by an earlier run. */
  skipped: number;
}

export interface LegacyImportReport {
  dryRun: boolean;
  formatVersion: number;
  exportedAt: string | null;
  /** Number of warnings the old app wrote into export-summary.txt. */
  exportWarnings: number;
  counts: Record<LegacyImportTable, LegacyImportCounts>;
  /** What the importer changed on the way, e.g. recipients merged by name. */
  notes: string[];
}

/** One row of a bank file, as the bank wrote it, plus what the importer suggests. */
export interface BankImportRow {
  /** Line in the file (the header is line 1). */
  line: number;
  /** YYYY-MM-DD; null for a reserved row that the bank has not booked yet. */
  date: string | null;
  /** Signed øre: negative is money out of the account. */
  amount: number;
  currency: string;
  /** Name of the other party as the bank shows it. */
  counterparty: string | null;
  /** Message, KID or other text on the row. */
  text: string | null;
  /** The bank's payment type, e.g. "Avtalegiro". */
  bankType: string | null;
  otherAccountNumber: string | null;
  reserved: boolean;
  suggestion: {
    type: TransactionType;
    /** Existing recipient with this name, or null for a new one. */
    recipientId: number | null;
    recipientName: string | null;
    categoryId: number | null;
    /** Transfers: the other account (source for money in, destination for money out). */
    otherAccountId: number | null;
    description: string | null;
  };
  /** An existing transaction on the account with the same date and amount. */
  duplicateOf: number | null;
  warnings: string[];
}

export interface BankImportPreview {
  format: BankFormat;
  formatLabel: string;
  /** Account number the file belongs to, when the file shows it. */
  accountNumber: string | null;
  /** The chosen or guessed account; null when no account matches the number. */
  accountId: number | null;
  rows: BankImportRow[];
  /** Lines the importer could not read, e.g. a row without an amount. */
  problems: string[];
}

export interface BankImportResult {
  created: number;
  ids: number[];
  /** Recipients created for names that did not exist yet. */
  recipientsCreated: number;
  /** Recipients that got a default category from this import. */
  defaultsSaved: number;
}
