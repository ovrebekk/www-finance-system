import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** created/updated timestamps and the user who made the change. */
const audit = () => ({
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedBy: integer('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export const roles = sqliteTable('roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  /** JSON array of permission names, see @finance/shared PERMISSIONS. */
  permissions: text('permissions', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: text('created_at').notNull().default(now),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** Always stored lower-case. */
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  roleId: integer('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'restrict' }),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const accounts = sqliteTable(
  'accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    type: text('type', { enum: ['checking', 'savings', 'credit_card', 'cash', 'loan', 'other'] }).notNull(),
    /** øre */
    openingBalance: integer('opening_balance').notNull().default(0),
    openingDate: text('opening_date').notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    notes: text('notes'),
    legacyId: text('legacy_id'),
    ...audit(),
  },
  (t) => [uniqueIndex('accounts_name_unique').on(sql`lower(${t.name})`)],
);

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['expense', 'income'] }).notNull(),
    parentId: integer('parent_id').references((): any => categories.id, { onDelete: 'restrict' }),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    legacyId: text('legacy_id'),
    ...audit(),
  },
  (t) => [
    // Names are unique among siblings (root categories count as siblings per kind).
    // NOTE: drizzle-kit 0.31 mis-quotes this expression; drizzle/0000_init.sql was fixed by hand.
    uniqueIndex('categories_sibling_name_unique').on(t.kind, sql`coalesce(${t.parentId}, 0)`, sql`lower(${t.name})`),
    index('categories_parent_idx').on(t.parentId),
  ],
);

export const recipients = sqliteTable(
  'recipients',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    defaultCategoryId: integer('default_category_id').references(() => categories.id, { onDelete: 'set null' }),
    notes: text('notes'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    legacyId: text('legacy_id'),
    ...audit(),
  },
  (t) => [uniqueIndex('recipients_name_unique').on(sql`lower(${t.name})`)],
);

export const tags = sqliteTable(
  'tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#64748b'),
    legacyId: text('legacy_id'),
    ...audit(),
  },
  (t) => [uniqueIndex('tags_name_unique').on(sql`lower(${t.name})`)],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type', { enum: ['expense', 'income', 'transfer'] }).notNull(),
    date: text('date').notNull(),
    /** øre, always > 0; the sign follows from the type. Equals the sum of its lines. */
    amount: integer('amount').notNull(),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    /** Destination account, transfers only. */
    toAccountId: integer('to_account_id').references(() => accounts.id, { onDelete: 'restrict' }),
    recipientId: integer('recipient_id').references(() => recipients.id, { onDelete: 'restrict' }),
    description: text('description'),
    status: text('status', { enum: ['pending', 'cleared', 'reconciled'] }).notNull().default('cleared'),
    /** Client-generated UUID; lets an offline-queued create be retried without duplicates. */
    clientId: text('client_id'),
    legacyId: text('legacy_id'),
    ...audit(),
  },
  (t) => [
    index('transactions_date_idx').on(t.date),
    index('transactions_account_idx').on(t.accountId, t.date),
    index('transactions_to_account_idx').on(t.toAccountId),
    index('transactions_recipient_idx').on(t.recipientId),
    uniqueIndex('transactions_client_id_unique').on(t.clientId),
  ],
);

/** A transaction is split into one or more lines; transfers have none. */
export const transactionLines = sqliteTable(
  'transaction_lines',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    /** øre, > 0 */
    amount: integer('amount').notNull(),
    memo: text('memo'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('lines_transaction_idx').on(t.transactionId), index('lines_category_idx').on(t.categoryId)],
);

export const transactionLineTags = sqliteTable(
  'transaction_line_tags',
  {
    lineId: integer('line_id')
      .notNull()
      .references(() => transactionLines.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.lineId, t.tagId] }), index('line_tags_tag_idx').on(t.tagId)],
);

/** A named set of transaction-list filters, private to the user who saved it. */
export const savedFilters = sqliteTable(
  'saved_filters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** JSON, see @finance/shared transactionFilterSchema. */
    filter: text('filter', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('saved_filters_user_name_unique').on(t.userId, sql`lower(${t.name})`)],
);
