import type { ReactNode } from 'react';
import type { SortDir } from '../lib/useListControls';

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="search"
      className="search"
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  current: string;
  dir: SortDir;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = current === sortKey;
  return (
    <th className={className} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sort-button" onClick={() => onSort(sortKey)}>
        {label}
        <span className="sort-indicator" aria-hidden="true">
          {active ? (dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className={`field${error ? ' field-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-message">{error}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading() {
  return <div className="loading">Loading…</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return <div className="error-box">{error instanceof Error ? error.message : 'Something went wrong'}</div>;
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>;
}
