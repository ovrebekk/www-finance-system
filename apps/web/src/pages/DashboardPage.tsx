import { useState } from 'react';
import { Link } from 'react-router';
import {
  ACCOUNT_TYPE_LABELS,
  formatNok,
  type Dashboard,
  type MonthSummary,
  type Transaction,
} from '@finance/shared';
import { formatMonth, formatShortMonth, isoMonth } from '../lib/dates';
import { transactionDependents, useAccounts, useCategories, useDashboard, useMe } from '../lib/queries';
import { toInput, TransactionForm } from '../components/TransactionForm';
import { TransactionRow, useNames } from '../components/TransactionRow';
import { useToast } from '../components/Toast';
import { useSaveTransaction } from '../lib/transactions';
import { useUndoableDelete } from '../lib/useUndoableDelete';
import { Empty, ErrorBox, Loading, PageHeader } from '../components/ui';

const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return isoMonth(new Date(y, m - 1 + delta, 1));
};

export function DashboardPage() {
  const me = useMe();
  const thisMonth = isoMonth(new Date());
  const [month, setMonth] = useState(thisMonth);
  const dashboard = useDashboard(month);
  const d = dashboard.data;

  return (
    <>
      <PageHeader title={`Hello, ${me.data?.name ?? ''}`} />

      <div className="month-nav">
        <button type="button" className="icon-button" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
          ‹
        </button>
        <h2 className="month-title">{formatMonth(month)}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Next month"
          disabled={month >= thisMonth}
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
        >
          ›
        </button>
        <Link className="link push-right" to={`/transactions?from=${month}-01&to=${month}-${lastDay(month)}`}>
          See transactions
        </Link>
      </div>

      {dashboard.isPending ? (
        <Loading />
      ) : dashboard.error ? (
        <ErrorBox error={dashboard.error} />
      ) : d ? (
        <>
          <MonthTiles current={d.current} previous={d.previous} />
          <div className="dashboard-grid">
            <CategoryBars dashboard={d} />
            <Trend trend={d.trend} />
          </div>
        </>
      ) : null}

      <Balances />
      {d && <Recent recent={d.recent} />}
    </>
  );
}

const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return String(new Date(y, m, 0).getDate()).padStart(2, '0');
};

function Delta({ now, before, goodWhenUp }: { now: number; before: number; goodWhenUp: boolean }) {
  if (before === 0) return <span className="muted small">No data last month</span>;
  const diff = now - before;
  if (diff === 0) return <span className="muted small">Same as last month</span>;
  const up = diff > 0;
  return (
    <span className={`small delta ${up === goodWhenUp ? 'delta-good' : 'delta-bad'}`}>
      {up ? '▲' : '▼'} {formatNok(Math.abs(diff))} vs last month
    </span>
  );
}

function MonthTiles({ current, previous }: { current: MonthSummary; previous: MonthSummary }) {
  return (
    <div className="tiles">
      <div className="tile">
        <span className="tile-label">Spent</span>
        <span className="tile-value amount">{formatNok(current.expense)}</span>
        <Delta now={current.expense} before={previous.expense} goodWhenUp={false} />
      </div>
      <div className="tile">
        <span className="tile-label">Income</span>
        <span className="tile-value amount">{formatNok(current.income)}</span>
        <Delta now={current.income} before={previous.income} goodWhenUp />
      </div>
      <div className="tile">
        <span className="tile-label">Net</span>
        <span className={`tile-value amount${current.net < 0 ? ' negative' : ''}`}>{formatNok(current.net)}</span>
        <Delta now={current.net} before={previous.net} goodWhenUp />
      </div>
    </div>
  );
}

/** Expense per top-level category this month, as horizontal bars. */
function CategoryBars({ dashboard }: { dashboard: Dashboard }) {
  const categories = useCategories();
  const names = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
  const rows = dashboard.expenseByCategory;
  const max = Math.max(1, ...rows.map((r) => r.amount));
  const [from, to] = [`${dashboard.month}-01`, `${dashboard.month}-${lastDay(dashboard.month)}`];
  return (
    <section className="card">
      <h2>Spending by category</h2>
      {rows.length === 0 ? (
        <Empty>No spending this month.</Empty>
      ) : (
        <ul className="hbars">
          {rows.map((r) => {
            const name = r.categoryId == null ? 'Uncategorised' : (names.get(r.categoryId) ?? '…');
            const share = dashboard.current.expense ? Math.round((r.amount / dashboard.current.expense) * 100) : 0;
            const to_ = `/transactions?from=${from}&to=${to}&type=expense&${r.categoryId == null ? 'uncategorized=true' : `categoryId=${r.categoryId}`}`;
            return (
              <li key={r.categoryId ?? 'none'}>
                <Link to={to_} className="hbar-row" title={`${name}: ${formatNok(r.amount)} (${share} %)`}>
                  <span className="hbar-label">{name}</span>
                  <span className="hbar-value amount">{formatNok(r.amount)}</span>
                  <span className="hbar-track" aria-hidden="true">
                    <span className="hbar-fill" style={{ width: `${Math.max(1, (r.amount / max) * 100)}%` }} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Income and expense for the last six months as grouped columns, one shared scale. */
function Trend({ trend }: { trend: MonthSummary[] }) {
  const [hover, setHover] = useState<MonthSummary>();
  const max = Math.max(1, ...trend.flatMap((m) => [m.income, m.expense]));
  const shown = hover ?? trend[trend.length - 1]!;
  return (
    <section className="card">
      <div className="card-header">
        <h2>Last six months</h2>
        <div className="legend" aria-hidden="true">
          <span className="legend-item">
            <span className="swatch-dot income" /> Income
          </span>
          <span className="legend-item">
            <span className="swatch-dot expense" /> Expense
          </span>
        </div>
      </div>
      <p className="trend-readout small" aria-live="polite">
        <strong>{formatMonth(shown.month)}</strong>: income {formatNok(shown.income)}, expense {formatNok(shown.expense)}
      </p>
      <div className="columns" role="img" aria-label="Income and expense per month for the last six months; details in the table below">
        {trend.map((m) => (
          <div
            key={m.month}
            className={`column-group${hover?.month === m.month ? ' is-hover' : ''}`}
            onMouseEnter={() => setHover(m)}
            onMouseLeave={() => setHover(undefined)}
            onClick={() => setHover(m)}
          >
            <div className="column-bars">
              <span className="column income" style={{ height: `${(m.income / max) * 100}%` }} />
              <span className="column expense" style={{ height: `${(m.expense / max) * 100}%` }} />
            </div>
            <span className="column-label">{formatShortMonth(m.month)}</span>
          </div>
        ))}
      </div>
      <details className="table-view">
        <summary className="small">Show as table</summary>
        <table className="mini-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Income</th>
              <th className="num">Expense</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {trend.map((m) => (
              <tr key={m.month}>
                <td>{formatMonth(m.month)}</td>
                <td className="num amount">{formatNok(m.income)}</td>
                <td className="num amount">{formatNok(m.expense)}</td>
                <td className={`num amount${m.net < 0 ? ' negative' : ''}`}>{formatNok(m.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function Balances() {
  const accounts = useAccounts();
  const active = (accounts.data ?? []).filter((a) => !a.archived);
  const total = active.reduce((sum, a) => sum + a.balance, 0);
  return (
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
              <Link to={`/transactions?accountId=${a.id}`} className="plain-link">
                {a.name}
                <span className="muted"> · {ACCOUNT_TYPE_LABELS[a.type]}</span>
              </Link>
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
  );
}

function Recent({ recent }: { recent: Transaction[] }) {
  const save = useSaveTransaction();
  const toast = useToast();
  const { hidden, remove } = useUndoableDelete(transactionDependents);
  const [editing, setEditing] = useState<Transaction>();
  const names = useNames();
  const rows = recent.filter((t) => !hidden.has(t.id));
  return (
    <section className="card">
      <div className="card-header">
        <h2>Recent transactions</h2>
        <Link to="/transactions" className="link">
          All transactions
        </Link>
      </div>
      {rows.length === 0 ? (
        <Empty>No transactions yet. Use the + button to add one.</Empty>
      ) : (
        <table className="data-table transaction-table flat">
          <tbody>
            {rows.map((t) => (
              <TransactionRow key={t.id} t={t} names={names} onOpen={() => setEditing(t)} />
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <TransactionForm
          title="Edit transaction"
          initial={toInput(editing)}
          onClose={() => setEditing(undefined)}
          onDelete={() => {
            remove(editing.id, `/transactions/${editing.id}`, `transaction of ${formatNok(editing.amount)}`);
            setEditing(undefined);
          }}
          save={async (body) => {
            await save.mutateAsync({ id: editing.id, body });
            toast.show('Transaction saved');
            setEditing(undefined);
          }}
        />
      )}
    </section>
  );
}
