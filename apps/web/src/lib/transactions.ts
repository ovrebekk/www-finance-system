import type { Transaction, TransactionInput } from '@finance/shared';
import { api, RequestError } from './api';
import { enqueue, newClientId } from './offline';
import { transactionDependents, useApiMutation } from './queries';

export type SaveTransactionVars = { id?: number; body: TransactionInput };
export type SaveResult = { queued: false; transaction: Transaction } | { queued: true };

/**
 * Creates (no id) or replaces a transaction, then refreshes everything it
 * affects. A new transaction that cannot reach the server is queued on this
 * device instead (see offline.ts); editing a stored one needs a connection.
 */
export function useSaveTransaction() {
  return useApiMutation(async ({ id, body }: SaveTransactionVars): Promise<SaveResult> => {
    if (id !== undefined) {
      try {
        return { queued: false, transaction: await api<Transaction>(`/transactions/${id}`, { method: 'PUT', body }) };
      } catch (err) {
        if (err instanceof RequestError && err.status === 0) {
          throw new RequestError(0, 'offline', 'You are offline. Changes to saved transactions need a connection; new ones can be added offline.');
        }
        throw err;
      }
    }
    const clientId = body.clientId ?? newClientId();
    try {
      return { queued: false, transaction: await api<Transaction>('/transactions', { method: 'POST', body: { ...body, clientId } }) };
    } catch (err) {
      if (err instanceof RequestError && err.status === 0) {
        enqueue(body, clientId);
        return { queued: true };
      }
      throw err;
    }
  }, transactionDependents);
}

export const savedMessage = (result: SaveResult) =>
  result.queued ? 'Saved on this device. It will be sent when you are back online.' : 'Transaction saved';

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
