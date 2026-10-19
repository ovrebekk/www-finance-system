import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { api, errorMessage } from './api';

const UNDO_MS = 10_000;

/**
 * Hides an item at once and only sends the DELETE after 10 seconds, so the
 * toast's Undo can cancel it. Pending deletes are flushed when the page is hidden.
 */
export function useUndoableDelete(invalidate: QueryKey[]) {
  const toast = useToast();
  const qc = useQueryClient();
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const pending = useRef(new Map<number, { timer: ReturnType<typeof setTimeout>; path: string }>());

  const unhide = (id: number) =>
    setHidden((h) => {
      const next = new Set(h);
      next.delete(id);
      return next;
    });

  const commit = useCallback(
    async (id: number, keepalive = false) => {
      const entry = pending.current.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.current.delete(id);
      try {
        await api(entry.path, { method: 'DELETE', keepalive });
        await Promise.all(invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
      } catch (err) {
        toast.show(errorMessage(err), { kind: 'error', duration: 6000 });
      } finally {
        unhide(id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, toast],
  );

  // Flush pending deletes when the page is hidden or the list page unmounts.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    const flush = () => {
      for (const id of [...pending.current.keys()]) void commitRef.current(id, true);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  const remove = (id: number, path: string, label: string) => {
    setHidden((h) => new Set(h).add(id));
    const timer = setTimeout(() => void commit(id), UNDO_MS);
    pending.current.set(id, { timer, path });
    toast.show(`Deleted ${label}`, {
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          const entry = pending.current.get(id);
          if (entry) clearTimeout(entry.timer);
          pending.current.delete(id);
          unhide(id);
        },
      },
    });
  };

  return { hidden, remove };
}
