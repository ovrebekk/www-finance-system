import { z } from 'zod';
import { PERMISSIONS } from './permissions.js';

export const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'cash', 'loan', 'other'] as const;
export const CATEGORY_KINDS = ['expense', 'income'] as const;
export const TRANSACTION_TYPES = ['expense', 'income', 'transfer'] as const;
export const TRANSACTION_STATUSES = ['pending', 'cleared', 'reconciled'] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type CategoryKind = (typeof CATEGORY_KINDS)[number];
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit card',
  cash: 'Cash',
  loan: 'Loan',
  other: 'Other',
};

const name = z.string().trim().min(1, 'Name is required').max(100, 'Name is too long');
const notes = z.string().trim().max(2000).optional().nullable().transform((v) => (v ? v : null));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');
const ore = z.number().int('Amount must be whole øre').refine(Number.isSafeInteger, 'Amount is too large');
export const idSchema = z.coerce.number().int().positive();

export const idParamSchema = z.object({ id: idSchema });

// ---- Auth ----
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')),
  password: z.string().min(1, 'Password is required').max(1000),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---- Accounts ----
export const accountInputSchema = z.object({
  name,
  type: z.enum(ACCOUNT_TYPES),
  openingBalance: ore.default(0),
  openingDate: isoDate,
  archived: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  notes,
});
export const accountUpdateSchema = accountInputSchema.partial();
export type AccountInput = z.input<typeof accountInputSchema>;

// ---- Categories ----
export const categoryInputSchema = z.object({
  name,
  kind: z.enum(CATEGORY_KINDS),
  parentId: idSchema.nullable().optional().transform((v) => v ?? null),
  archived: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});
export const categoryUpdateSchema = z.object({
  name: name.optional(),
  parentId: idSchema.nullable().optional(),
  archived: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;

/** Deleting a used category or one with children requires a target to move things to. */
export const categoryDeleteQuerySchema = z.object({
  moveTo: idSchema.optional(),
});

// ---- Recipients ----
export const recipientInputSchema = z.object({
  name,
  defaultCategoryId: idSchema.nullable().optional().transform((v) => v ?? null),
  notes,
  archived: z.boolean().default(false),
});
export const recipientUpdateSchema = z.object({
  name: name.optional(),
  defaultCategoryId: idSchema.nullable().optional(),
  notes,
  archived: z.boolean().optional(),
});
export type RecipientInput = z.input<typeof recipientInputSchema>;

// ---- Tags ----
export const tagColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #3366cc');
export const tagInputSchema = z.object({
  name,
  color: tagColorSchema.default('#64748b'),
});
export const tagUpdateSchema = tagInputSchema.partial();
export type TagInput = z.input<typeof tagInputSchema>;

/** Merge the item in the URL into `intoId`; the URL item is deleted afterwards. */
export const mergeSchema = z.object({ intoId: idSchema });

// ---- Roles ----
export const roleInputSchema = z.object({
  name,
  permissions: z.array(z.enum(PERMISSIONS)),
});

// ---- Transactions ----
export const transactionLineInputSchema = z.object({
  categoryId: idSchema.nullable().optional().transform((v) => v ?? null),
  amount: ore.refine((v) => v > 0, 'Line amounts must be greater than zero'),
  memo: z.string().trim().max(500).optional().nullable().transform((v) => (v ? v : null)),
  tagIds: z.array(idSchema).max(50).default([]),
});

/**
 * Expense and income carry one or more lines (more than one is a split) and
 * their amount is the sum of the lines. Transfers carry no lines; their
 * amount is given directly and they need a destination account.
 */
export const transactionInputSchema = z
  .object({
    type: z.enum(TRANSACTION_TYPES),
    date: isoDate,
    accountId: idSchema,
    toAccountId: idSchema.nullable().optional().transform((v) => v ?? null),
    recipientId: idSchema.nullable().optional().transform((v) => v ?? null),
    /** Used when recipientId is empty: an existing recipient with this name, or a new one. */
    recipientName: z.string().trim().max(100).optional().nullable().transform((v) => (v ? v : null)),
    description: z.string().trim().max(500).optional().nullable().transform((v) => (v ? v : null)),
    status: z.enum(TRANSACTION_STATUSES).default('cleared'),
    /** Transfers only. */
    amount: ore.optional(),
    lines: z.array(transactionLineInputSchema).max(100).default([]),
    /** Client-generated id that makes offline-queued creates safe to retry. */
    clientId: z.string().uuid().optional().nullable().transform((v) => v ?? null),
  })
  .superRefine((t, ctx) => {
    if (t.type === 'transfer') {
      if (t.toAccountId == null) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Choose the account to transfer to' });
      else if (t.toAccountId === t.accountId)
        ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Transfer to a different account' });
      if (t.amount === undefined || t.amount <= 0)
        ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Amount must be greater than zero' });
      if (t.lines.length > 0) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Transfers have no category lines' });
    } else {
      if (t.lines.length === 0) ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Add at least one line' });
      if (t.toAccountId != null) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Only transfers have a destination account' });
      if (t.amount !== undefined && t.amount !== t.lines.reduce((s, l) => s + l.amount, 0))
        ctx.addIssue({ code: 'custom', path: ['amount'], message: 'The split lines must add up to the total' });
    }
  });
/** Request body for creating or replacing a transaction (see transactionInputSchema). */
export interface TransactionInput {
  type: TransactionType;
  date: string;
  accountId: number;
  toAccountId?: number | null;
  recipientId?: number | null;
  recipientName?: string | null;
  description?: string | null;
  status?: TransactionStatus;
  amount?: number;
  lines?: TransactionLineInput[];
  clientId?: string | null;
}
export interface TransactionLineInput {
  categoryId?: number | null;
  amount: number;
  memo?: string | null;
  tagIds?: number[];
}

const optionalId = z.preprocess((v) => (v === '' || v === null ? undefined : v), idSchema.optional());
const optionalOre = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().optional());
const optionalDate = z.preprocess((v) => (v === '' || v === null ? undefined : v), isoDate.optional());

/** Filters for the transaction list. Also the stored shape of a saved filter. */
export const transactionFilterSchema = z.object({
  from: optionalDate,
  to: optionalDate,
  accountId: optionalId,
  /** Matches the category and all its subcategories. 0 is not allowed; use `uncategorized`. */
  categoryId: optionalId,
  uncategorized: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).optional(),
  recipientId: optionalId,
  tagId: optionalId,
  type: z.preprocess((v) => (v === '' ? undefined : v), z.enum(TRANSACTION_TYPES).optional()),
  status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(TRANSACTION_STATUSES).optional()),
  /** øre, compared with the transaction total. */
  minAmount: optionalOre,
  maxAmount: optionalOre,
  q: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(200).optional()),
});
export type TransactionFilter = z.infer<typeof transactionFilterSchema>;

export const transactionListQuerySchema = transactionFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---- Saved filters ----
export const savedFilterInputSchema = z.object({
  name,
  filter: transactionFilterSchema,
});
export const savedFilterUpdateSchema = savedFilterInputSchema.partial();

// ---- Dashboard ----
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use the format YYYY-MM');
export const dashboardQuerySchema = z.object({ month: monthSchema.optional() });

// ---- Legacy import ----
/** Files the old PersonalFinanceWPF app writes into its export folder (raw/ is not used). */
export const LEGACY_EXPORT_FILES = [
  'export-summary.txt',
  'accounts.csv',
  'categories.csv',
  'recipients.csv',
  'tags.csv',
  'transactions.csv',
  'transaction_lines.csv',
  'transaction_line_tags.csv',
] as const;
export type LegacyExportFile = (typeof LEGACY_EXPORT_FILES)[number];

/** File contents by file name. `dryRun` checks and counts everything, then rolls back. */
export const legacyImportInputSchema = z.object({
  files: z.partialRecord(z.enum(LEGACY_EXPORT_FILES), z.string().max(50 * 1024 * 1024)),
  dryRun: z.boolean().default(false),
});
export type LegacyImportInput = z.input<typeof legacyImportInputSchema>;

// ---- Bank import ----
/** Bank export formats the importer reads; detected from the header row when not given. */
export const BANK_FORMATS = ['nordea'] as const;
export type BankFormat = (typeof BANK_FORMATS)[number];

/** Parses a bank's CSV export into suggested transactions. Nothing is saved. */
export const bankImportPreviewSchema = z.object({
  fileName: z.string().trim().max(255).optional().nullable().transform((v) => v ?? null),
  content: z.string().min(1, 'The file is empty').max(10 * 1024 * 1024, 'The file is too large'),
  format: z.enum(BANK_FORMATS).optional(),
  /** The account the file belongs to; guessed from the account number in the file when empty. */
  accountId: idSchema.optional(),
});
export type BankImportPreviewInput = z.input<typeof bankImportPreviewSchema>;

/**
 * Saves the reviewed rows in one go: either all of them or none. Each row is
 * a normal transaction (validated with transactionInputSchema on the server);
 * `line` is the row's line in the file, for error messages.
 */
export const bankImportCommitSchema = z.object({
  rows: z
    .array(z.object({ line: z.number().int().min(1), transaction: z.unknown() }))
    .min(1, 'Choose at least one row to import')
    .max(5000),
  /** Use each row's category as its recipient's default category when the recipient has none. */
  saveRecipientDefaults: z.boolean().default(true),
});
export type BankImportCommitInput = z.input<typeof bankImportCommitSchema>;
