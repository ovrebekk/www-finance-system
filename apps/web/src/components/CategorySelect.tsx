import { buildCategoryTree, descendantIds, flattenTree, type Category, type CategoryKind } from '@finance/shared';

/** Indented category picker; optionally limited to one or more kinds (in that order) and excluding a subtree. */
export function CategorySelect({
  categories,
  value,
  onChange,
  kind,
  excludeSubtreeOf,
  emptyLabel = '— None —',
  allowEmpty = true,
  id,
}: {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
  kind?: CategoryKind | CategoryKind[];
  excludeSubtreeOf?: number;
  emptyLabel?: string;
  allowEmpty?: boolean;
  id?: string;
}) {
  const excluded = excludeSubtreeOf !== undefined ? descendantIds(categories, excludeSubtreeOf) : new Set<number>();
  const groups: CategoryKind[] = Array.isArray(kind) ? kind : kind ? [kind] : ['expense', 'income'];
  const options = (k: CategoryKind) =>
    flattenTree(buildCategoryTree(categories.filter((c) => c.kind === k && (!c.archived || c.id === value))))
      .filter((c) => !excluded.has(c.id))
      .map((c) => (
        <option key={c.id} value={c.id}>
          {'   '.repeat(c.depth)}
          {c.name}
        </option>
      ));

  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {(allowEmpty || value === null) && <option value="">{emptyLabel}</option>}
      {groups.length === 1
        ? options(groups[0]!)
        : groups.map((k) => (
            <optgroup key={k} label={k === 'expense' ? 'Expense' : 'Income'}>
              {options(k)}
            </optgroup>
          ))}
    </select>
  );
}
