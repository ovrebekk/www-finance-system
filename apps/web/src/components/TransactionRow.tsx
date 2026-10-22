import type { ReactNode } from 'react';
import { formatNok, type Tag, type Transaction } from '@finance/shared';
import { formatDay } from '../lib/dates';
import { TagChips } from './TagPicker';

/** Lookup tables for showing ids as names. */
export interface Names {
  account: Map<number, string>;
  recipient: Map<number, string>;
  category: Map<number, string>;
  tag: Map<number, Tag>;
}

/** Signed display amount: expenses negative, income positive, transfers unsigned. */
export function signedAmount(t: Pick<Transaction, 'type' | 'amount'>) {
  return t.type === 'expense' ? -t.amount : t.amount;
}

export function TransactionRow({
  t,
  names,
  onOpen,
  badge,
}: {
  t: Pick<Transaction, 'type' | 'date' | 'amount' | 'accountId' | 'toAccountId' | 'recipientId' | 'description' | 'lines'> & {
    recipientName?: string | null;
  };
  names: Names;
  onOpen: () => void;
  badge?: ReactNode;
}) {
  const title =
    t.type === 'transfer'
      ? `${names.account.get(t.accountId) ?? '?'} → ${names.account.get(t.toAccountId ?? 0) ?? '?'}`
      : (t.recipientId != null ? names.recipient.get(t.recipientId) : t.recipientName) || t.description || 'No recipient';
  const category =
    t.type === 'transfer'
      ? 'Transfer'
      : t.lines.length > 1
        ? `Split: ${t.lines.map((l) => names.category.get(l.categoryId ?? 0)?.split(' > ').pop() ?? 'Uncategorised').join(', ')}`
        : (names.category.get(t.lines[0]?.categoryId ?? 0) ?? 'Uncategorised');
  const tagIds = [...new Set(t.lines.flatMap((l) => l.tagIds))];
  const amount = signedAmount(t);
  return (
    <tr>
      <td data-label="Date" className="nowrap">
        {formatDay(t.date)}
      </td>
      <td data-label="Name">
        <button type="button" className="row-link" onClick={onOpen}>
          <strong>{title}</strong>
        </button>{' '}
        {badge}
        <div className="muted small">
          {category}
          {t.description && title !== t.description && <> · {t.description}</>}
        </div>
        <TagChips tags={names.tag} ids={tagIds} />
      </td>
      <td data-label="Account">{names.account.get(t.accountId) ?? '—'}</td>
      <td data-label="Amount" className={`num amount${amount < 0 ? ' negative' : t.type === 'income' ? ' positive' : ''}`}>
        {formatNok(amount)}
      </td>
    </tr>
  );
}
