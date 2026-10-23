import type { AccountType, CategoryKind, TransactionFilter, TransactionStatus, TransactionType } from './schemas.js';
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
  /** Expense per top-level category this month, largest first. */
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
