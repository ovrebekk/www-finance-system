import type { Transaction, TransactionInput } from '@finance/shared';
import { api } from './api';
import { transactionDependents, useApiMutation } from './queries';

export type SaveTransactionVars = { id?: number; body: TransactionInput };

/** Creates (no id) or replaces a transaction, then refreshes everything it affects. */
export function useSaveTransaction() {
  return useApiMutation(
    ({ id, body }: SaveTransactionVars) =>
      id === undefined
        ? api<Transaction>('/transactions', { method: 'POST', body })
        : api<Transaction>(`/transactions/${id}`, { method: 'PUT', body }),
    transactionDependents,
  );
}

const LAST_ACCOUNT_KEY = 'finance.lastAccountId';

/** The account used for the previous new transaction on this device. */
export function lastAccountId(): number | null {
  try {
    const v = Number(localStorage.getItem(LAST_ACCOUNT_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function rememberAccount(id: number) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, String(id));
  } catch {
    // Storage can be unavailable (private mode); remembering is only a convenience.
  }
}
