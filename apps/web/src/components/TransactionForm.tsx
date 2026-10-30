import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  categoryKindsFor,
  formatAmount,
  formatNok,
  parseAmount,
  TRANSACTION_STATUSES,
  type Transaction,
  type TransactionInput,
  type TransactionType,
} from '@finance/shared';
import { errorMessage } from '../lib/api';
import { today } from '../lib/dates';
import { useAccounts, useCategories, useRecipients, useTags } from '../lib/queries';
import { lastAccountId, rememberAccount } from '../lib/transactions';
import { CategorySelect } from './CategorySelect';
import { Modal } from './Modal';
import { TagPicker } from './TagPicker';
import { Field } from './ui';

const TYPE_LABELS: Record<TransactionType, string> = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };
const STATUS_LABELS = { pending: 'Pending', cleared: 'Cleared', reconciled: 'Reconciled' } as const;

interface LineState {
  key: number;
  categoryId: number | null;
  amount: string;
  memo: string;
  tagIds: number[];
}

/** The input that would recreate `t` (for editing). */
export function toInput(t: Transaction): TransactionInput {
  return {
    type: t.type,
    date: t.date,
    accountId: t.accountId,
    toAccountId: t.toAccountId,
    recipientId: t.recipientId,
    description: t.description,
    status: t.status,
    amount: t.amount,
    lines: t.lines.map((l) => ({ categoryId: l.categoryId, amount: l.amount, memo: l.memo, tagIds: l.tagIds })),
  };
}

/**
 * Add or edit a transaction. With "Split" the amount is divided over several
 * lines, each with its own category, memo and tags; the lines must add up to
 * the total. `save` rejects with an error to show in the form.
 */
export function TransactionForm({
  title,
  initial,
  save,
  onClose,
  onDelete,
  allowAddAnother = false,
}: {
  title: string;
  initial?: TransactionInput;
  save: (body: TransactionInput, addAnother: boolean) => Promise<void>;
  onClose: () => void;
  onDelete?: () => void;
  allowAddAnother?: boolean;
}) {
  const accounts = useAccounts();
  const categories = useCategories();
  const recipients = useRecipients();
  const tags = useTags();
  const nextKey = useRef(1);
  const newLine = (over: Partial<LineState> = {}): LineState => ({
    key: nextKey.current++,
    categoryId: null,
    amount: '',
    memo: '',
    tagIds: [],
    ...over,
  });

  const activeAccounts = (accounts.data ?? []).filter((a) => !a.archived || a.id === initial?.accountId || a.id === initial?.toAccountId);
  const recipientById = useMemo(() => new Map((recipients.data ?? []).map((r) => [r.id, r])), [recipients.data]);
  const recipientByName = useMemo(
    () => new Map((recipients.data ?? []).map((r) => [r.name.toLocaleLowerCase('nb'), r])),
    [recipients.data],
  );

  const [type, setType] = useState<TransactionType>(initial?.type ?? 'expense');
  const [date, setDate] = useState(initial?.date ?? today());
  const [accountId, setAccountId] = useState<number | null>(initial?.accountId ?? lastAccountId());
  const [toAccountId, setToAccountId] = useState<number | null>(initial?.toAccountId ?? null);
  const [amount, setAmount] = useState(initial?.amount ? formatAmount(initial.amount) : '');
  const [recipient, setRecipient] = useState(
    initial?.recipientId != null ? (recipientById.get(initial.recipientId)?.name ?? '') : (initial?.recipientName ?? ''),
  );
  // When editing before the recipient list has loaded, fill the name in once it arrives.
  const initialRecipientName = initial?.recipientId != null ? recipientById.get(initial.recipientId)?.name : undefined;
  useEffect(() => {
    if (initialRecipientName) setRecipient((r) => r || initialRecipientName);
  }, [initialRecipientName]);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'cleared');
  const initialLines = initial?.lines ?? [];
  const [split, setSplit] = useState(initialLines.length > 1);
  const [lines, setLines] = useState<LineState[]>(() =>
    initialLines.length > 0
      ? initialLines.map((l) =>
          newLine({ categoryId: l.categoryId ?? null, amount: formatAmount(l.amount), memo: l.memo ?? '', tagIds: l.tagIds ?? [] }),
        )
      : [newLine()],
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // The account list may arrive after the form opens; fall back to the first account.
  const effectiveAccountId = accountId ?? activeAccounts[0]?.id ?? null;
  const total = parseAmount(amount);
  const lineSum = lines.reduce((sum, l) => sum + (parseAmount(l.amount) ?? 0), 0);
  const remaining = (total ?? 0) - lineSum;

  const updateLine = (key: number, patch: Partial<LineState>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const changeType = (t: TransactionType) => {
    setType(t);
    // Clear the categories the new type cannot use (income may also use expense categories).
    const kindOf = new Map((categories.data ?? []).map((c) => [c.id, c.kind]));
    const allowed = categoryKindsFor(t);
    setLines((ls) => ls.map((l) => (l.categoryId != null && !allowed.includes(kindOf.get(l.categoryId)!) ? { ...l, categoryId: null } : l)));
  };

  const changeRecipient = (name: string) => {
    setRecipient(name);
    const match = recipientByName.get(name.trim().toLocaleLowerCase('nb'));
    const category = match?.defaultCategoryId != null ? categories.data?.find((c) => c.id === match.defaultCategoryId) : undefined;
    if (!split && category && categoryKindsFor(type).includes(category.kind) && lines[0]?.categoryId == null) {
      updateLine(lines[0]!.key, { categoryId: category.id });
    }
  };

  const startSplit = () => {
    const first = lines[0] ?? newLine();
    setLines([{ ...first, amount: amount }, newLine()]);
    setSplit(true);
  };

  /** When exactly one line has no amount yet, give it what is left of the total. */
  const fillLastEmptyLine = () => {
    const empty = lines.filter((l) => l.amount.trim() === '');
    if (empty.length === 1 && total != null && remaining > 0) updateLine(empty[0]!.key, { amount: formatAmount(remaining) });
  };

  const endSplit = () => {
    setLines((ls) => [ls[0] ?? newLine()]);
    setSplit(false);
  };

  const build = (): TransactionInput | string => {
    if (!effectiveAccountId) return 'Choose an account';
    const base = {
      type,
      date,
      accountId: effectiveAccountId,
      description,
      status,
    };
    if (type === 'transfer') {
      if (total == null || total <= 0) return 'Enter an amount greater than zero';
      if (!toAccountId) return 'Choose the account to transfer to';
      if (toAccountId === effectiveAccountId) return 'Transfer to a different account';
      return { ...base, toAccountId, amount: total, lines: [] };
    }
    const name = recipient.trim();
    const match = name ? recipientByName.get(name.toLocaleLowerCase('nb')) : undefined;
    const who = match ? { recipientId: match.id } : { recipientId: null, recipientName: name || null };
    if (!split) {
      if (total == null) return 'Enter an amount';
      if (total <= 0) return type === 'expense' ? 'Enter a positive amount; use Income for money coming in' : 'Enter a positive amount';
      const line = lines[0]!;
      return { ...base, ...who, lines: [{ categoryId: line.categoryId, amount: total, memo: null, tagIds: line.tagIds }] };
    }
    const parsed = lines.map((l) => parseAmount(l.amount));
    if (parsed.some((a) => a == null || a <= 0)) return 'Every split line needs an amount greater than zero';
    const sum = parsed.reduce<number>((s, a) => s + (a ?? 0), 0);
    if (total != null && total !== sum) return `The lines add up to ${formatNok(sum)}, but the total is ${formatNok(total)}`;
    return {
      ...base,
      ...who,
      amount: sum,
      lines: lines.map((l, i) => ({ categoryId: l.categoryId, amount: parsed[i]!, memo: l.memo, tagIds: l.tagIds })),
    };
  };

  const submit = async (e: FormEvent, addAnother = false) => {
    e.preventDefault();
    const body = build();
    if (typeof body === 'string') return setError(body);
    setError(undefined);
    if (!initial) rememberAccount(body.accountId);
    setBusy(true);
    try {
      await save(body, addAnother);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const accountOptions = (exclude?: number | null) =>
    activeAccounts
      .filter((a) => a.id !== exclude)
      .map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ));

  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)} noValidate>
        <div className="segmented" role="radiogroup" aria-label="Type">
          {(Object.keys(TYPE_LABELS) as TransactionType[]).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={type === t} className="segment" onClick={() => changeType(t)}>
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="field-row">
          <Field label={split ? 'Total' : 'Amount'} hint={split ? 'Optional; checked against the lines' : undefined}>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus={!initial}
              placeholder="0,00"
              className="amount-input"
            />
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>

        <div className="field-row">
          <Field label={type === 'transfer' ? 'From account' : 'Account'}>
            <select value={effectiveAccountId ?? ''} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}>
              {effectiveAccountId == null && <option value="">— Choose —</option>}
              {accountOptions()}
            </select>
          </Field>
          {type === 'transfer' ? (
            <Field label="To account">
              <select value={toAccountId ?? ''} onChange={(e) => setToAccountId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Choose —</option>
                {accountOptions(effectiveAccountId)}
              </select>
            </Field>
          ) : (
            <Field label="Recipient" hint={recipient && !recipientByName.has(recipient.trim().toLocaleLowerCase('nb')) ? 'New recipient' : undefined}>
              <input list="recipient-options" value={recipient} onChange={(e) => changeRecipient(e.target.value)} maxLength={100} />
              <datalist id="recipient-options">
                {(recipients.data ?? [])
                  .filter((r) => !r.archived)
                  .map((r) => (
                    <option key={r.id} value={r.name} />
                  ))}
              </datalist>
            </Field>
          )}
        </div>

        {type !== 'transfer' && !split && (
          <>
            <Field label="Category">
              <CategorySelect
                categories={categories.data ?? []}
                kind={categoryKindsFor(type)}
                value={lines[0]?.categoryId ?? null}
                onChange={(id) => updateLine(lines[0]!.key, { categoryId: id })}
                emptyLabel="— Uncategorised —"
              />
            </Field>
            <div className="field">
              <span className="field-label">Tags</span>
              <TagPicker tags={tags.data ?? []} value={lines[0]?.tagIds ?? []} onChange={(ids) => updateLine(lines[0]!.key, { tagIds: ids })} />
            </div>
            <button type="button" className="button button-small align-start" onClick={startSplit}>
              Split into several categories
            </button>
          </>
        )}

        {type !== 'transfer' && split && (
          <fieldset className="split">
            <legend className="field-label">Split</legend>
            {lines.map((l, i) => (
              <div key={l.key} className="split-line">
                <div className="split-line-main">
                  <CategorySelect
                    categories={categories.data ?? []}
                    kind={categoryKindsFor(type)}
                    value={l.categoryId}
                    onChange={(id) => updateLine(l.key, { categoryId: id })}
                    emptyLabel="— Uncategorised —"
                  />
                  <input
                    inputMode="decimal"
                    aria-label={`Line ${i + 1} amount`}
                    placeholder="0,00"
                    className="amount-input split-amount"
                    value={l.amount}
                    onChange={(e) => updateLine(l.key, { amount: e.target.value })}
                    onBlur={fillLastEmptyLine}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove line ${i + 1}`}
                    disabled={lines.length <= 1}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    ×
                  </button>
                </div>
                <input placeholder="Memo" aria-label={`Line ${i + 1} memo`} value={l.memo} maxLength={500} onChange={(e) => updateLine(l.key, { memo: e.target.value })} />
                <TagPicker tags={tags.data ?? []} value={l.tagIds} onChange={(ids) => updateLine(l.key, { tagIds: ids })} />
              </div>
            ))}
            <div className="split-footer">
              <button
                type="button"
                className="button button-small"
                onClick={() => setLines((ls) => [...ls, newLine({ amount: total != null && remaining > 0 ? formatAmount(remaining) : '' })])}
              >
                + Add line
              </button>
              <span className={`small${total != null && remaining !== 0 ? ' remaining-off' : ' muted'}`}>
                {total == null ? `Lines total ${formatNok(lineSum)}` : remaining === 0 ? 'Lines match the total' : `${formatNok(remaining)} left to assign`}
              </span>
            </div>
            <button type="button" className="button button-small button-quiet align-start" onClick={endSplit}>
              Undo split (keep the first line's category)
            </button>
          </fieldset>
        )}

        <Field label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {TRANSACTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>

        {error && <div className="error-box">{error}</div>}
        <div className="form-actions">
          {onDelete && (
            <button type="button" className="button button-quiet push-left" onClick={onDelete}>
              Delete
            </button>
          )}
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          {allowAddAnother && (
            <button type="button" className="button" disabled={busy} onClick={(e) => void submit(e, true)}>
              Save and add another
            </button>
          )}
          <button type="submit" className="button button-primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
