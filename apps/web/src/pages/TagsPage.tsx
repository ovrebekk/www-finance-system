import { useState, type FormEvent } from 'react';
import type { Tag } from '@finance/shared';
import { api, errorMessage } from '../lib/api';
import { keys, useApiMutation, useTags } from '../lib/queries';
import { useListControls } from '../lib/useListControls';
import { useUndoableDelete } from '../lib/useUndoableDelete';
import { MergeDialog } from '../components/MergeDialog';
import { ConfirmDialog, Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Empty, ErrorBox, Field, Loading, PageHeader, SearchBox, SortHeader } from '../components/ui';

const PALETTE = ['#64748b', '#1f6f5c', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2'];

type Editing = { mode: 'new' } | { mode: 'edit'; tag: Tag };

export function TagsPage() {
  const tags = useTags();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing>();
  const [formKey, setFormKey] = useState(0);
  const [deleting, setDeleting] = useState<Tag>();
  const [merging, setMerging] = useState<Tag>();
  const { hidden, remove } = useUndoableDelete([keys.tags]);
  const merge = useApiMutation(
    ({ id, intoId }: { id: number; intoId: number }) => api(`/tags/${id}/merge`, { method: 'POST', body: { intoId } }),
    [keys.tags],
  );
  const list = useListControls(
    (tags.data ?? []).filter((t) => !hidden.has(t.id)),
    { search: (t) => t.name, sorters: { name: (t) => t.name, usage: (t) => t.usageCount }, initialSort: 'name' },
  );

  return (
    <>
      <PageHeader
        title="Tags"
        actions={
          <button type="button" className="button button-primary" onClick={() => setEditing({ mode: 'new' })}>
            + Add tag
          </button>
        }
      />
      <div className="toolbar">
        <SearchBox value={list.query} onChange={list.setQuery} placeholder="Search tags" />
      </div>
      {tags.isPending ? (
        <Loading />
      ) : tags.error ? (
        <ErrorBox error={tags.error} />
      ) : list.rows.length === 0 ? (
        <Empty>{list.query ? 'No tags match your search.' : 'No tags yet. Tags cut across categories, e.g. "Ferie 2026".'}</Empty>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader label="Name" sortKey="name" current={list.sortKey} dir={list.sortDir} onSort={list.toggleSort} />
              <SortHeader label="Used on lines" sortKey="usage" current={list.sortKey} dir={list.sortDir} onSort={list.toggleSort} className="num" />
              <th className="actions-col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((t) => (
              <tr key={t.id}>
                <td data-label="Name">
                  <span className="tag-chip" style={{ '--tag': t.color } as React.CSSProperties}>
                    {t.name}
                  </span>
                </td>
                <td data-label="Used on lines" className="num">
                  {t.usageCount}
                </td>
                <td className="actions-col">
                  <button type="button" className="button button-small" onClick={() => setEditing({ mode: 'edit', tag: t })}>
                    Edit
                  </button>
                  <button type="button" className="button button-small button-quiet" onClick={() => setMerging(t)}>
                    Merge
                  </button>
                  <button type="button" className="button button-small button-quiet" onClick={() => setDeleting(t)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <TagForm
          key={formKey}
          tag={editing.mode === 'edit' ? editing.tag : undefined}
          onClose={() => setEditing(undefined)}
          onSaved={(t, again) => {
            toast.show(`Saved ${t.name}`);
            if (again) setFormKey((k) => k + 1);
            else setEditing(undefined);
          }}
        />
      )}

      {merging && (
        <MergeDialog
          what="tag"
          source={merging}
          items={tags.data ?? []}
          usage={`${merging.usageCount} tagged lines`}
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

      {deleting && (
        <ConfirmDialog
          title="Delete tag?"
          message={
            deleting.usageCount > 0
              ? `"${deleting.name}" is on ${deleting.usageCount} transaction lines. Deleting it removes the tag from those lines; the transactions stay.`
              : `Delete "${deleting.name}"?`
          }
          onClose={() => setDeleting(undefined)}
          onConfirm={() => {
            remove(deleting.id, `/tags/${deleting.id}`, deleting.name);
            setDeleting(undefined);
          }}
        />
      )}
    </>
  );
}

function TagForm({ tag, onClose, onSaved }: { tag?: Tag; onClose: () => void; onSaved: (t: Tag, addAnother: boolean) => void }) {
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? PALETTE[0]!);
  const [error, setError] = useState<string>();
  const save = useApiMutation(
    (body: unknown) => (tag ? api<Tag>(`/tags/${tag.id}`, { method: 'PATCH', body }) : api<Tag>('/tags', { method: 'POST', body })),
    [keys.tags],
  );
  const submit = (e: FormEvent, addAnother = false) => {
    e.preventDefault();
    if (!name.trim()) return setError('Name is required');
    save.mutate({ name, color }, { onSuccess: (t) => onSaved(t, addAnother), onError: (err) => setError(errorMessage(err)) });
  };

  return (
    <Modal title={tag ? 'Edit tag' : 'New tag'} onClose={onClose}>
      <form className="form" onSubmit={(e) => submit(e)} noValidate>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} />
        </Field>
        <Field label="Colour">
          <div className="swatches">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                style={{ background: c }}
                aria-label={`Colour ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
              />
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom colour" />
          </div>
        </Field>
        <div>
          <span className="tag-chip" style={{ '--tag': color } as React.CSSProperties}>
            {name || 'Preview'}
          </span>
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          {!tag && (
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
