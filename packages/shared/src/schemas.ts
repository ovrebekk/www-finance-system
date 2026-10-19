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
