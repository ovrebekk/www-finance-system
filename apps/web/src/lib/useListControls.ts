import { useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

/** Search + sort state for a list page. */
export function useListControls<T>(
  items: T[] | undefined,
  options: {
    search: (item: T) => string;
    sorters: Record<string, (item: T) => string | number>;
    initialSort: string;
  },
) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(options.initialSort);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('nb');
    const filtered = (items ?? []).filter((i) => !q || options.search(i).toLocaleLowerCase('nb').includes(q));
    const get = options.sorters[sortKey];
    if (!get) return filtered;
    return [...filtered].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'nb');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return { rows, query, setQuery, sortKey, sortDir, toggleSort };
}
