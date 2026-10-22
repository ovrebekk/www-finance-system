import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { syncQueue, useOfflineQueue, useOnline } from '../lib/offline';
import { transactionDependents } from '../lib/queries';
import { useToast } from './Toast';

const RETRY_MS = 30_000;

/** Sends queued offline transactions when possible and shows the offline state. */
export function OfflineStatus() {
  const online = useOnline();
  const queue = useOfflineQueue();
  const qc = useQueryClient();
  const toast = useToast();
  const waiting = queue.filter((q) => !q.error).length;
  const refused = queue.length - waiting;

  const sync = async () => {
    const sent = await syncQueue();
    if (sent > 0) {
      toast.show(sent === 1 ? 'Sent 1 transaction saved offline' : `Sent ${sent} transactions saved offline`);
      await Promise.all(transactionDependents.map((queryKey) => qc.invalidateQueries({ queryKey })));
    }
  };

  // Try on start, whenever the browser says it is back online or the app comes to the front, and every 30 s while waiting.
  useEffect(() => {
    if (!online || waiting === 0) return;
    void sync();
    const timer = setInterval(() => void sync(), RETRY_MS);
    const onVisible = () => document.visibilityState === 'visible' && void sync();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, waiting]);

  if (online && queue.length === 0) return null;
  return (
    <div className={`offline-bar${online ? '' : ' is-offline'}`} role="status">
      {!online && <span>You are offline. New transactions are saved on this device.</span>}
      {waiting > 0 && (
        <span>
          {waiting === 1 ? '1 transaction is' : `${waiting} transactions are`} waiting to be sent.
          {online && (
            <button type="button" className="link-button" onClick={() => void sync()}>
              Send now
            </button>
          )}
        </span>
      )}
      {refused > 0 && <span>{refused === 1 ? '1 saved transaction was' : `${refused} saved transactions were`} refused; fix it under Transactions.</span>}
    </div>
  );
}
