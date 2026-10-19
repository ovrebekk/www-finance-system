import type { AccountType, CategoryKind } from './schemas.js';
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
