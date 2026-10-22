import { useSyncExternalStore } from 'react';
import type { Transaction, TransactionInput } from '@finance/shared';
import { api, RequestError } from './api';

/**
 * New transactions entered without a connection wait in this queue (kept in
 * localStorage) and are sent when the app is back online. Each one carries a
 * clientId, so a send that reached the server but lost its answer is not
 * stored twice when it is retried.
 */
export interface QueuedTransaction {
  clientId: string;
  body: TransactionInput;
  queuedAt: string;
  /** Why the server refused it; the entry stays until it is fixed or removed. */
  error?: string;
}

const STORAGE_KEY = 'finance.offlineQueue.v1';
const listeners = new Set<() => void>();
let queue: QueuedTransaction[] = load();

function load(): QueuedTransaction[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as QueuedTransaction[]) : [];
  } catch {
    return [];
  }
}

function persist(next: QueuedTransaction[]) {
  queue = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Without storage the queue still lives for this session.
  }
  for (const l of listeners) l();
}

// Another tab may change the queue.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      queue = load();
      for (const l of listeners) l();
    }
  });
}

/** RFC 4122 v4; crypto.randomUUID needs a secure context, which a LAN dev URL is not. */
export function newClientId(): string {
  if (typeof crypto.randomUUID === 'function' && window.isSecureContext) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function enqueue(body: TransactionInput, clientId = newClientId()) {
  persist([...queue, { clientId, body: { ...body, clientId }, queuedAt: new Date().toISOString() }]);
}

export function updateQueued(clientId: string, body: TransactionInput) {
  persist(queue.map((q) => (q.clientId === clientId ? { ...q, body: { ...body, clientId }, error: undefined } : q)));
}

export function removeQueued(clientId: string) {
  persist(queue.filter((q) => q.clientId !== clientId));
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const useOfflineQueue = () => useSyncExternalStore(subscribe, () => queue);

let syncing: Promise<number> | null = null;

/**
 * Sends queued transactions in order. Stops at the first network or server
 * failure (to try again later); a refused entry (4xx) keeps its error and the
 * rest still go. Returns how many were stored.
 */
export function syncQueue(): Promise<number> {
  syncing ??= (async () => {
    let sent = 0;
    try {
      for (const entry of [...queue]) {
        if (entry.error) continue;
        try {
          await api<Transaction>('/transactions', { method: 'POST', body: entry.body });
          removeQueued(entry.clientId);
          sent++;
        } catch (err) {
          if (!(err instanceof RequestError) || err.status === 0 || err.status === 401 || err.status >= 500) break;
          persist(queue.map((q) => (q.clientId === entry.clientId ? { ...q, error: err.message } : q)));
        }
      }
    } finally {
      syncing = null;
    }
    return sent;
  })();
  return syncing;
}

const subscribeOnline = (fn: () => void) => {
  window.addEventListener('online', fn);
  window.addEventListener('offline', fn);
  return () => {
    window.removeEventListener('online', fn);
    window.removeEventListener('offline', fn);
  };
};

export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

/** A queued body shown like a stored transaction in lists. */
export function queuedAsTransaction(q: QueuedTransaction) {
  const lines = q.body.lines ?? [];
  return {
    type: q.body.type,
    date: q.body.date,
    amount: q.body.amount ?? lines.reduce((s, l) => s + l.amount, 0),
    accountId: q.body.accountId,
    toAccountId: q.body.toAccountId ?? null,
    recipientId: q.body.recipientId ?? null,
    recipientName: q.body.recipientName ?? null,
    description: q.body.description ?? null,
    lines: lines.map((l, i) => ({ id: -i - 1, categoryId: l.categoryId ?? null, amount: l.amount, memo: l.memo ?? null, tagIds: l.tagIds ?? [] })),
  };
}
