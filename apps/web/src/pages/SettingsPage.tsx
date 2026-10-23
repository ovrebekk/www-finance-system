import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { keys, useMe, useUsers } from '../lib/queries';
import { useOfflineQueue } from '../lib/offline';
import { LegacyImport } from '../components/LegacyImport';
import { PageHeader } from '../components/ui';

export function SettingsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const isAdmin = Boolean(me.data?.permissions.includes('users:admin'));
  const canBackup = Boolean(me.data?.permissions.includes('settings:admin'));
  const users = useUsers(isAdmin);
  const queued = useOfflineQueue().length;

  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    qc.setQueryData(keys.me, null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== keys.me[0] });
    // Drop the offline copy of API responses so the next user cannot see them.
    if ('caches' in window) void caches.delete('api').catch(() => undefined);
  };

  return (
    <>
      <PageHeader title="Settings" />
      <section className="card">
        <h2>Signed in</h2>
        <p>
          {me.data?.name} · {me.data?.email} · <span className="muted">{me.data?.role}</span>
        </p>
        <button type="button" className="button" onClick={signOut}>
          Sign out
        </button>
        {queued > 0 && (
          <p className="muted small">
            {queued === 1 ? '1 transaction saved offline is' : `${queued} transactions saved offline are`} still on this device. They
            are sent after the next sign-in here.
          </p>
        )}
      </section>

      {canBackup && (
        <section className="card">
          <h2>Backup</h2>
          <p className="muted">
            The server writes a backup every night at 03:00. You can also download a full copy of the database now.
          </p>
          <a className="button button-primary" href="/api/v1/settings/backup" download>
            Download backup
          </a>
          <p className="muted small">CSV export of transactions arrives with the transaction list in phase 2.</p>
        </section>
      )}

      {canBackup && <LegacyImport />}

      {isAdmin && (
        <section className="card">
          <h2>Users</h2>
          <ul className="plain-list">
            {(users.data ?? []).map((u) => (
              <li key={u.id}>
                <strong>{u.name}</strong> <span className="muted">· {u.email} · {u.role}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Adding users and roles comes in a later phase. Use the set-password script on the server to reset a password.
          </p>
        </section>
      )}
    </>
  );
}
