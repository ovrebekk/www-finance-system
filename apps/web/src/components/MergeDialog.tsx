import { useState } from 'react';
import { ConfirmDialog } from './Modal';
import { Field } from './ui';

/** Pick another item to merge `source` into. */
export function MergeDialog<T extends { id: number; name: string }>({
  what,
  source,
  items,
  usage,
  onClose,
  onMerge,
}: {
  what: string;
  source: T;
  items: T[];
  usage: string;
  onClose: () => void;
  onMerge: (intoId: number) => void;
}) {
  const [intoId, setIntoId] = useState<number | null>(null);
  const options = items.filter((i) => i.id !== source.id).sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  return (
    <ConfirmDialog
      title={`Merge ${what}`}
      message={`${usage} from "${source.name}" will move to the ${what} you choose, and "${source.name}" will be deleted.`}
      confirmLabel="Merge"
      danger={false}
      confirmDisabled={intoId === null}
      onClose={onClose}
      onConfirm={() => intoId !== null && onMerge(intoId)}
    >
      <Field label={`Merge into`}>
        <select value={intoId ?? ''} onChange={(e) => setIntoId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— Choose —</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>
    </ConfirmDialog>
  );
}
