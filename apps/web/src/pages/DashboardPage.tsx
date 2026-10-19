import { Link } from 'react-router';
import { ACCOUNT_TYPE_LABELS, formatNok } from '@finance/shared';
import { useAccounts, useMe } from '../lib/queries';
import { Empty, ErrorBox, Loading, PageHeader } from '../components/ui';

export function DashboardPage() {
  const me = useMe();
  const accounts = useAccounts();
  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const total = active.reduce((sum, a) => sum + a.balance, 0);

  return (
    <>
      <PageHeader title={`Hello, ${me.data?.name ?? ''}`} />
      <section className="card">
        <div className="card-header">
          <h2>Balances</h2>
          <Link to="/accounts" className="link">
            Manage accounts
          </Link>
        </div>
        {accounts.isPending ? (
          <Loading />
        ) : accounts.error ? (
          <ErrorBox error={accounts.error} />
        ) : active.length === 0 ? (
          <Empty>
            No accounts yet. <Link to="/accounts">Add your first account</Link>.
          </Empty>
        ) : (
          <ul className="balance-list">
            {active.map((a) => (
              <li key={a.id}>
                <span>
                  {a.name}
                  <span className="muted"> · {ACCOUNT_TYPE_LABELS[a.type]}</span>
                </span>
                <span className={`amount${a.balance < 0 ? ' negative' : ''}`}>{formatNok(a.balance)}</span>
              </li>
            ))}
            <li className="balance-total">
              <span>Total</span>
              <span className={`amount${total < 0 ? ' negative' : ''}`}>{formatNok(total)}</span>
            </li>
          </ul>
        )}
      </section>
      <section className="card">
        <h2>Transactions</h2>
        <p className="muted">
          Transaction entry, the filtered transaction list and this month's spending arrive in phase 2.
        </p>
      </section>
    </>
  );
}
