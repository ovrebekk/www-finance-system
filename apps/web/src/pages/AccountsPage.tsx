import { useState, type FormEvent } from 'react';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  accountInputSchema,
  formatAmount,
  formatNok,
  parseAmount,
  type Account,
  type AccountType,
} from '@finance/shared';
import { api, errorMessage } from '../lib/api';
import { keys, useAccounts, useApiMutation } from '../lib/queries';
import { useListControls } from '../lib/useListControls';
import { useUndoableDelete } from '../lib/useUndoableDelete';
import { ConfirmDialog, Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Empty, ErrorBox, Field, Loading, PageHeader, SearchBox, SortHeader } from '../components/ui';

type Editing = { mode: 'new' } | { mode: 'edit'; account: Account };

export function AccountsPage() {
  const accounts = useAccounts();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing>();
  const [formKey, setFormKey] = useState(0);
  const [deleting, setDeleting] = useState<Account>();
  const [showArchived, setShowArchived] = useState(false);
  const { hidden, remove } = useUndoableDelete([keys.accounts]);
  const archive = useApiMutation(
    (a: Account) => api(`/accounts/${a.id}`, { method: 'PATCH', body: { archived: !a.archived } }),
    [keys.accounts],
  );

  const visible = (accounts.data ?? []).filter((a) => !hidden.has(a.id) && (showArchived || !a.archived));
  const list = useListControls(visible, {
    search: (a) => `${a.name} ${ACCOUNT_TYPE_LABELS[a.type]} ${a.notes ?? ''}`,
    sorters: {
      name: (a) => a.name,
      type: (a) => ACCOUNT_TYPE_LABELS[a.type],
      balance: (a) => a.balance,
    },
    initialSort: 'name',
  });
  const archivedCount = (accounts.data ?? []).filter((a) => a.archived).length;

  return (
    <>
      <PageHeader
        title="Accounts"
        actions={
          <button type="button" className="button button-primary" onClick={() => setEditing({ mode: 'new' })}>
            + Add account
          </button>
        }
      />
      <div className="toolbar">
        <SearchBox value={list.query} onChange={list.setQuery} placeholder="Search accounts" />
        {archivedCount > 0 && (
          <label className="checkbox">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived ({archivedCount})
          </label>
        )}
      </div>

      {accounts.isPending ? (
        <Loading />
      ) : accounts.error ? (
        <ErrorBox error={accounts.error} />
      ) : list.rows.length === 0 ? (
        <Empty>{list.query ? 'No accounts match your search.' : 'No accounts yet. Add your bank accounts, cards and cash.'}</Empty>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader label="Name" sortKey="name" current={list.sortKey} dir={list.sortDir} onSort={list.toggleSort} />
              <SortHeader label="Type" sortKey="type" current={list.sortKey} dir={list.sortDir} onSort={list.toggleSort} />
              <SortHeader
                label="Balance"
                sortKey="balance"
                current={list.sortKey}
                dir={list.sortDir}
                onSort={list.toggleSort}
                className="num"
              />
              <th className="actions-col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((a) => (
              <tr key={a.id} className={a.archived ? 'archived' : undefined}>
                <td data-label="Name">
                  <strong>{a.name}</strong> {a.archived && <Badge>Archived</Badge>}
                  {a.notes && <div className="muted small">{a.notes}</div>}
                </td>
                <td data-label="Type">{ACCOUNT_TYPE_LABELS[a.type]}</td>
                <td data-label="Balance" className={`num amount${a.balance < 0 ? ' negative' : ''}`}>
                  {formatNok(a.balance)}
                </td>
                <td className="actions-col">
                  <button type="button" className="button button-small" onClick={() => setEditing({ mode: 'edit', account: a })}>
                    Edit
                  </button>
                  <button type="button" className="button button-small button-quiet" onClick={() => setDeleting(a)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <AccountForm
          key={formKey}
          account={editing.mode === 'edit' ? editing.account : undefined}
          onClose={() => setEditing(undefined)}
          onSaved={(a, again) => {
            toast.show(`Saved ${a.name}`);
            if (again) {
              setEditing({ mode: 'new' });
              setFormKey((k) => k + 1);
            }
            else setEditing(undefined);
          }}
        />
      )}

      {deleting &&
        (deleting.transactionCount > 0 ? (
          <ConfirmDialog
            title="Account in use"
            message={`${deleting.name} has ${deleting.transactionCount} transactions and cannot be deleted. Archive it instead? Archived accounts are hidden from pickers but stay in reports.`}
            confirmLabel={deleting.archived ? 'Unarchive' : 'Archive'}
            danger={false}
            onClose={() => setDeleting(undefined)}
            onConfirm={() => {
              archive.mutate(deleting, { onError: (err) => toast.show(errorMessage(err), { kind: 'error' }) });
              setDeleting(undefined);
            }}
          />
        ) : (
          <ConfirmDialog
            title="Delete account?"
            message={`Delete ${deleting.name}? It has no transactions.`}
            onClose={() => setDeleting(undefined)}
            onConfirm={() => {
              remove(deleting.id, `/accounts/${deleting.id}`, deleting.name);
              setDeleting(undefined);
            }}
          />
        ))}
    </>
  );
}

function AccountForm({
  account,
  onClose,
  onSaved,
}: {
  account?: Account;
  onClose: () => void;
  onSaved: (a: Account, addAnother: boolean) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking');
  const [opening, setOpening] = useState(account ? formatAmount(account.openingBalance) : '0,00');
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? today);
  const [notes, setNotes] = useState(account?.notes ?? '');
  const [archived, setArchived] = useState(account?.archived ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const save = useApiMutation(
    (body: unknown) =>
      account
        ? api<Account>(`/accounts/${account.id}`, { method: 'PATCH', body })
        : api<Account>('/accounts', { method: 'POST', body }),
    [keys.accounts],
  );

  const submit = (e: FormEvent<HTMLFormElement>, addAnother = false) => {
    e.preventDefault();
    const openingBalance = parseAmount(opening);
    const body = { name, type, openingBalance: openingBalance ?? NaN, openingDate, notes, archived };
    const parsed = accountInputSchema.safeParse(body);
    const nextErrors: Record<string, string> = {};
    if (openingBalance === null) nextErrors.openingBalance = 'Enter an amount, e.g. 1 234,50';
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        nextErrors[key] ??= issue.message;
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setFormError(undefined);
    save.mutate(body, {
      onSuccess: (a) => onSaved(a, addAnother),
      onError: (err) => setFormError(errorMessage(err)),
    });
  };

  return (
    <Modal title={account ? 'Edit account' : 'New account'} onClose={onClose}>
      <form id="account-form" className="form" onSubmit={(e) => submit(e)} noValidate>
        <Field label="Name" error={errors.name}>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required maxLength={100} />
        </Field>
        <Field label="Type" error={errors.type}>
          <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <div className="field-row">
          <Field label="Opening balance (NOK)" error={errors.openingBalance}>
            <input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </Field>
          <Field label="Opening date" error={errors.openingDate}>
            <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes" error={errors.notes}>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {account && (
          <label className="checkbox">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Archived (hidden from pickers, kept in reports)
          </label>
        )}
        {formError && <div className="error-box">{formError}</div>}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          {!account && (
            <button
              type="button"
              className="button"
              disabled={save.isPending}
              onClick={(e) => submit(e as unknown as FormEvent<HTMLFormElement>, true)}
            >
              Save and add another
            </button>
          )}
          <button type="submit" className="button button-primary" disabled={save.isPending}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
