import type { CSSProperties } from 'react';
import type { Tag } from '@finance/shared';

/** Toggle chips for picking any number of tags. */
export function TagPicker({ tags, value, onChange }: { tags: Tag[]; value: number[]; onChange: (ids: number[]) => void }) {
  if (tags.length === 0) return <span className="muted small">No tags yet. Add them under Tags.</span>;
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="tag-picker">
      {[...tags]
        .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
        .map((t) => (
          <button
            key={t.id}
            type="button"
            className="tag-chip tag-toggle"
            aria-pressed={value.includes(t.id)}
            style={{ '--tag': t.color } as CSSProperties}
            onClick={() => toggle(t.id)}
          >
            {t.name}
          </button>
        ))}
    </div>
  );
}

export function TagChips({ tags, ids }: { tags: Map<number, Tag>; ids: number[] }) {
  if (ids.length === 0) return null;
  return (
    <span className="tag-list">
      {ids.map((id) => {
        const tag = tags.get(id);
        return tag ? (
          <span key={id} className="tag-chip tag-chip-small" style={{ '--tag': tag.color } as CSSProperties}>
            {tag.name}
          </span>
        ) : null;
      })}
    </span>
  );
}
