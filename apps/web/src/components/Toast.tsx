import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: { label: string; onClick: () => void };
  duration: number;
}

interface ToastApi {
  show: (message: string, options?: { kind?: 'info' | 'error'; action?: ToastItem['action']; duration?: number }) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback<ToastApi['show']>((message, options = {}) => {
    const id = nextId.current++;
    const item: ToastItem = { id, message, kind: options.kind ?? 'info', action: options.action, duration: options.duration ?? 4000 };
    // Keep at most three; never drop a toast that still offers an action (e.g. Undo) in favour of plain ones.
    setToasts((t) => {
      const next = [...t, item];
      while (next.length > 3) {
        const i = next.findIndex((x) => !x.action);
        next.splice(i === -1 ? 0 : i, 1);
      }
      return next;
    });
    return id;
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <Toast key={t.id} item={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onDone }: { item: ToastItem; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const timer = setTimeout(() => done.current(), item.duration);
    return () => clearTimeout(timer);
  }, [item.id, item.duration]);
  return (
    <div className={`toast toast-${item.kind}`}>
      <span>{item.message}</span>
      {item.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            item.action!.onClick();
            onDone();
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDone}>
        ×
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
