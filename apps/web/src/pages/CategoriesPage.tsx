import { useMemo, useState, type FormEvent } from 'react';
import { buildCategoryTree, descendantIds, type Category, type CategoryKind, type CategoryNode } from '@finance/shared';
import { api, errorMessage } from '../lib/api';
import { keys, useApiMutation, useCategories } from '../lib/queries';
import { useUndoableDelete } from '../lib/useUndoableDelete';
import { CategorySelect } from '../components/CategorySelect';
import { ConfirmDialog, Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Empty, ErrorBox, Field, Loading, PageHeader, SearchBox } from '../components/ui';

type Editing = { mode: 'new'; parentId: number | null } | { mode: 'edit'; category: Category };

export function CategoriesPage() {
  const categories = useCategories();
  const toast = useToast();
  const [kind, setKind] = useState<CategoryKind>('expense');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Editing>();
  const [formKey, setFormKey] = useState(0);
  const [deleting, setDeleting] = useState<CategoryNode>();
  const { hidden, remove } = useUndoableDelete([keys.categories, keys.recipients]);

  const all = categories.data ?? [];
  const tree = useMemo(() => {
    const visible = all.filter((c) => c.kind === kind && !hidden.has(c.id) && (showArchived || !c.archived));
    return buildCategoryTree(visible);
  }, [all, kind, hidden, showArchived]);

  // When searching, show matches and their ancestors, fully expanded.
  const q = query.trim().toLocaleLowerCase('nb');
  const matches = (n: CategoryNode): boolean => n.name.toLocaleLowerCase('nb').includes(q) || n.children.some(matches);

  const toggle = (id: number) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderNodes = (nodes: CategoryNode[]) =>
    nodes
      .filter((n) => !q || matches(n))
      .map((n) => {
        const isCollapsed = !q && collapsed.has(n.id);
        return (
          <li key={n.id} className={n.archived ? 'archived' : undefined}>
            <div className="tree-row" style={{ paddingLeft: `${n.depth * 1.25 + 0.5}rem` }}>
              {n.children.length > 0 ? (
                <button
                  type="button"
                  className="tree-toggle"
                  aria-label={isCollapsed ? `Expand ${n.name}` : `Collapse ${n.name}`}
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(n.id)}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span className="tree-toggle-spacer" />
              )}
              <span className="tree-name">
                {n.name} {n.archived && <Badge>Archived</Badge>}
              </span>
              <span className="muted small tree-count" title="Transaction lines">
                {n.usageCount > 0 ? `${n.usageCount} used` : ''}
              </span>
              <span className="tree-actions">
                <button
                  type="button"
                  className="button button-small button-quiet"
                  title="Add subcategory"
                  onClick={() => setEditing({ mode: 'new', parentId: n.id })}
                >
                  + Sub
                </button>
                <button type="button" className="button button-small" onClick={() => setEditing({ mode: 'edit', category: n })}>
                  Edit
                </button>
                <button type="button" className="button button-small button-quiet" onClick={() => setDeleting(n)}>
                  Delete
                </button>
              </span>
            </div>
            {!isCollapsed && n.children.length > 0 && <ul className="tree">{renderNodes(n.children)}</ul>}
          </li>
        );
      });

  const archivedCount = all.filter((c) => c.kind === kind && c.archived).length;

  return (
    <>
      <PageHeader
        title="Categories"
        actions={
          <button type="button" className="button button-primary" onClick={() => setEditing({ mode: 'new', parentId: null })}>
            + Add category
          </button>
        }
      />
      <div className="tabs" role="tablist">
        {(['expense', 'income'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className="tab" onClick={() => setKind(k)}>
            {k === 'expense' ? 'Expense' : 'Income'}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Search categories" />
        {archivedCount > 0 && (
          <label className="checkbox">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived ({archivedCount})
          </label>
        )}
      </div>

      {categories.isPending ? (
        <Loading />
      ) : categories.error ? (
        <ErrorBox error={categories.error} />
      ) : tree.length === 0 ? (
        <Empty>No {kind} categories yet.</Empty>
      ) : (
        <ul className="tree tree-root card">{renderNodes(tree)}</ul>
      )}

      {editing && (
        <CategoryForm
          key={formKey}
          kind={editing.mode === 'edit' ? editing.category.kind : kind}
          category={editing.mode === 'edit' ? editing.category : undefined}
          initialParentId={editing.mode === 'new' ? editing.parentId : editing.category.parentId}
          categories={all}
          onClose={() => setEditing(undefined)}
          onSaved={(c, again) => {
            toast.show(`Saved ${c.name}`);
            if (again) {
              setEditing({ mode: 'new', parentId: c.parentId });
              setFormKey((k) => k + 1);
            } else setEditing(undefined);
          }}
        />
      )}

      {deleting && (
        <DeleteCategoryDialog
          category={deleting}
          categories={all}
          onClose={() => setDeleting(undefined)}
          onConfirm={(moveTo) => {
            const path = `/categories/${deleting.id}${moveTo ? `?moveTo=${moveTo}` : ''}`;
            remove(deleting.id, path, deleting.name);
            setDeleting(undefined);
          }}
        />
      )}
    </>
  );
}

function DeleteCategoryDialog({
  category,
  categories,
  onClose,
  onConfirm,
}: {
  category: CategoryNode;
  categories: Category[];
  onClose: () => void;
  onConfirm: (moveTo: number | null) => void;
}) {
  const childCount = categories.filter((c) => c.parentId === category.id).length;
  const needsTarget = category.usageCount > 0 || childCount > 0;
  const [moveTo, setMoveTo] = useState<number | null>(null);
  const parts = [
    category.usageCount > 0 && `${category.usageCount} transaction lines`,
    childCount > 0 && `${childCount} subcategories`,
  ].filter(Boolean);

  return (
    <ConfirmDialog
      title="Delete category?"
      message={
        needsTarget
          ? `${category.path} has ${parts.join(' and ')}. Choose where to move them before deleting.`
          : `Delete ${category.path}?`
      }
      confirmDisabled={needsTarget && moveTo === null}
      onClose={onClose}
      onConfirm={() => onConfirm(needsTarget ? moveTo : null)}
    >
      {needsTarget && (
        <Field label="Move to">
          <CategorySelect
            categories={categories}
            kind={category.kind}
            excludeSubtreeOf={category.id}
            value={moveTo}
            onChange={setMoveTo}
            emptyLabel="— Choose a category —"
          />
        </Field>
      )}
    </ConfirmDialog>
  );
}

function CategoryForm({
  kind,
  category,
  initialParentId,
  categories,
  onClose,
  onSaved,
}: {
  kind: CategoryKind;
  category?: Category;
  initialParentId: number | null;
  categories: Category[];
  onClose: () => void;
  onSaved: (c: Category, addAnother: boolean) => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParentId] = useState<number | null>(initialParentId);
  const [archived, setArchived] = useState(category?.archived ?? false);
  const [error, setError] = useState<string>();
  const save = useApiMutation(
    (body: unknown) =>
      category
        ? api<Category>(`/categories/${category.id}`, { method: 'PATCH', body })
        : api<Category>('/categories', { method: 'POST', body }),
    [keys.categories],
  );

  const invalidParent = category && parentId !== null && descendantIds(categories, category.id).has(parentId);

  const submit = (e: FormEvent, addAnother = false) => {
    e.preventDefault();
    if (!name.trim()) return setError('Name is required');
    const body = category ? { name, parentId, archived } : { name, kind, parentId };
    save.mutate(body, {
      onSuccess: (c) => onSaved(c, addAnother),
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <Modal title={category ? 'Edit category' : `New ${kind} category`} onClose={onClose}>
      <form className="form" onSubmit={(e) => submit(e)} noValidate>
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} />
        </Field>
        <Field label="Parent" error={invalidParent ? 'Cannot move under itself' : undefined}>
          <CategorySelect
            categories={categories}
            kind={kind}
            excludeSubtreeOf={category?.id}
            value={parentId}
            onChange={setParentId}
            emptyLabel="— None (top level) —"
          />
        </Field>
        {category && (
          <label className="checkbox">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Archived (hidden from pickers, kept in reports)
          </label>
        )}
        {error && <div className="error-box">{error}</div>}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          {!category && (
            <button type="button" className="button" disabled={save.isPending} onClick={(e) => submit(e, true)}>
              Save and add another
            </button>
          )}
          <button type="submit" className="button button-primary" disabled={save.isPending || Boolean(invalidParent)}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
