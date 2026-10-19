import { useMemo, useState, type FormEvent } from 'react';
import { buildCategoryTree, flattenTree, formatNok, type Recipient } from '@finance/shared';
import { api, errorMessage } from '../lib/api';
import { keys, useApiMutation, useCategories, useRecipients } from '../lib/queries';
import { useListControls } from '../lib/useListControls';
import { useUndoableDelete } from '../lib/useUndoableDelete';
import { CategorySelect } from '../components/CategorySelect';
import { MergeDialog } from '../components/MergeDialog';
import { ConfirmDialog, Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Empty, ErrorBox, Field, Loading, PageHeader, SearchBox, SortHeader } from '../components/ui';

type Editing = { mode: 'new' } | { mode: 'edit'; recipient: Recipient };

export function RecipientsPage() {
  const recipients = useRecipients();
  const categories = useCategories();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing>();
  const [formKey, setFormKey] = useState(0);
  const [deleting, setDeleting] = useState<Recipient>();
  const [merging, setMerging] = useState<Recipient>();
  const [showArchived, setShowArchived] = useState(false);
  const { hidden, remove } = useUndoableDelete([keys.recipients]);
  const update = useApiMutation(
    ({ id, body }: { id: number; body: unknown }) => api(`/recipients/${id}`, { method: 'PATCH', body }),
    [keys.recipients],
  );
  const merge = useApiMutation(
    ({ id, intoId }: { id: number; intoId: number }) => api(`/recipients/${id}/merge`, { method: 'POST', body: { intoId } }),
    [keys.recipients],
  );

  const paths = useMemo(
    () => new Map(flattenTree(buildCategoryTree(categories.data ?? [])).map((c) => [c.id, c.path])),
    [categories.data],
  );
  const visible = (recipients.data ?? []).filter((r) => !hidden.has(r.id) && (showArchived || !r.archived));
  const list = useListControls(visible, {
    search: (r) => `${r.name} ${r.notes ?? ''} ${paths.get(r.defaultCategoryId ?? 0) ?? ''}`,
    sorters: {
      name: (r) => r.name,
      category: (r) => paths.get(r.defaultCategoryId ?? 0) ?? '',
      count: (r) => r.transactionCount,
      total: (r) => r.total,
    },
    initialSort: 'name',
  });
  const archivedCount = (recipients.data ?? []).filter((r) => r.archived).length;

  return (
    <>
      <PageHeader
        title="Recipients"
        actions={
          <button type="button" className="button button-primary" onClick={() => setEditing({ mode: 'new' })}>
            + Add recipient
          </button>
        }
      />
      <div className="toolbar">
        <SearchBox value={list.query} onChange={list.setQuery} placeholder="Search recipients" />
        {archivedCount > 0 && (
          <label className="checkbox">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived ({archivedCount})
          </label>
        )}
      </div>

      {recipients.isPending ? (
        <Loading />
      ) : recipients.error ? (
        <ErrorBox error={recipients.error} />
      ) : list.rows.length === 0 ? (
        <Empty>{list.query ? 'No recipients match your search.' : 'No recipients yet: shops, employers and people you pay.'}</Empty>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader label="Name" sortKey="name" current={list.sortKey} dir={list.sortDir} onSort={list.toggleSort} />
              <SortHeader
                label="Default category"
                sortKey="category"
                current={list.sortKey}
                dir={list.sortDir}
                onSort={list.toggleSort}
              />
              <SortHeader
                label="Transactions"
                sortKey="count"
                current={list.sortKey}
                dir={list.sortDir}
                onSort={list.toggleSort}
                className="num"
              />
              <SortHeader label="Total" sortKey="total" current={list.sortKey} dir={list.sortDir} onSort={list.toggleSort} className="num" />
              <th className="actions-col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.id} className={r.archived ? 'archived' : undefined}>
                <td data-label="Name">
                  <strong>{r.name}</strong> {r.archived && <Badge>Archived</Badge>}
                  {r.notes && <div className="muted small">{r.notes}</div>}
                </td>
                <td data-label="Default category">{paths.get(r.defaultCategoryId ?? 0) ?? <span className="muted">—</span>}</td>
                <td data-label="Transactions" className="num">
                  {r.transactionCount}
                </td>
                <td data-label="Total" className="num amount">
                  {formatNok(r.total)}
                </td>
                <td className="actions-col">
                  <button type="button" className="button button-small" onClick={() => setEditing({ mode: 'edit', recipient: r })}>
                    Edit
                  </button>
                  <button type="button" className="button button-small button-quiet" onClick={() => setMerging(r)}>
                    Merge
                  </button>
                  <button type="button" className="button button-small button-quiet" onClick={() => setDeleting(r)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <RecipientForm
          key={formKey}
          recipient={editing.mode === 'edit' ? editing.recipient : undefined}
          onClose={() => setEditing(undefined)}
          onSaved={(r, again) => {
            toast.show(`Saved ${r.name}`);
            if (again) setFormKey((k) => k + 1);
            else setEditing(undefined);
          }}
        />
      )}

      {merging && (
        <MergeDialog
          what="recipient"
          source={merging}
          items={(recipients.data ?? []).filter((r) => !r.archived || r.id === merging.id)}
          usage={`${merging.transactionCount} transactions`}
          onClose={() => setMerging(undefined)}
          onMerge={(intoId) => {
            merge.mutate(
              { id: merging.id, intoId },
              {
                onSuccess: () => toast.show(`Merged ${merging.name}`),
                onError: (err) => toast.show(errorMessage(err), { kind: 'error' }),
              },
            );
            setMerging(undefined);
          }}
        />
      )}

      {deleting &&
        (deleting.transactionCount > 0 ? (
          <ConfirmDialog
            title="Recipient in use"
            message={`${deleting.name} is used by ${deleting.transactionCount} transactions and cannot be deleted. Archive it, or merge it into another recipient.`}
            confirmLabel={deleting.archived ? 'Unarchive' : 'Archive'}
            danger={false}
            onClose={() => setDeleting(undefined)}
            onConfirm={() => {
              update.mutate(
                { id: deleting.id, body: { archived: !deleting.archived } },
                { onError: (err) => toast.show(errorMessage(err), { kind: 'error' }) },
              );
              setDeleting(undefined);
            }}
          />
        ) : (
          <ConfirmDialog
            title="Delete recipient?"
            message={`Delete ${deleting.name}?`}
            onClose={() => setDeleting(undefined)}
            onConfirm={() => {
              remove(deleting.id, `/recipients/${deleting.id}`, deleting.name);
              setDeleting(undefined);
            }}
          />
        ))}
    </>
  );
}

function RecipientForm({
  recipient,
  onClose,
  onSaved,
}: {
  recipient?: Recipient;
  onClose: () => void;
  onSaved: (r: Recipient, addAnother: boolean) => void;
}) {
  const categories = useCategories();
  const [name, setName] = useState(recipient?.name ?? '');
  const [defaultCategoryId, setDefaultCategoryId] = useState<number | null>(recipient?.defaultCategoryId ?? null);
  const [notes, setNotes] = useState(recipient?.notes ?? '');
  const [archived, setArchived] = useState(recipient?.archived ?? false);
  const [error, setError] = useState<string>();
  const save = useApiMutation(
    (body: unknown) =>
      recipient
        ? api<Recipient>(`/recipients/${recipient.id}`, { method: 'PATCH', body })
        : api<Recipient>('/recipients', { method: 'POST', body }),
    [keys.recipients],
  );

  const submit = (e: FormEvent, addAnother = false) => {
    e.preventDefault();
    if (!name.trim()) return setError('Name is required');
    save.mutate(
      { name, defaultCategoryId, notes, archived },
      { onSuccess: (r) => onSaved(r, addAnother), onError: (err) => setError(errorMessage(err)) },
    );
  };

  return (
    <Modal title={recipient ? 'Edit recipient' : 'New recipient'} onClose={onClose}>
      <form className="form" onSubmit={(e) => submit(e)} noValidate>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} />
        </Field>
        <Field label="Default category" hint="Pre-filled when you pick this recipient on a transaction">
          <CategorySelect categories={categories.data ?? []} value={defaultCategoryId} onChange={setDefaultCategoryId} />
        </Field>
        <Field label="Notes">
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {recipient && (
          <label className="checkbox">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Archived
          </label>
        )}
        {error && <div className="error-box">{error}</div>}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          {!recipient && (
            <button type="button" className="button" disabled={save.isPending} onClick={(e) => submit(e, true)}>
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
