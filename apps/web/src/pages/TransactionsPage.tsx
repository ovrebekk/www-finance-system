import { useMemo, useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  buildCategoryTree,
  flattenTree,
  formatNok,
  transactionFilterSchema,
  type SavedFilter,
  type Transaction,
  type TransactionFilter,
  type TransactionPage,
} from '@finance/shared';
import { api, errorMessage } from '../lib/api';
import { periodOf, periodRange, PERIODS, type Period } from '../lib/dates';
import {
  keys,
  transactionDependents,
  useAccounts,
  useApiMutation,
  useCategories,
  useRecipients,
  useSavedFilters,
  useTags,
} from '../lib/queries';
import { useSaveTransaction } from '../lib/transactions';
import { useUndoableDelete } from '../lib/useUndoableDelete';
import { Modal } from '../components/Modal';
import { toInput, TransactionForm } from '../components/TransactionForm';
import { useToast } from '../components/Toast';
import { Empty, ErrorBox, Field, Loading, PageHeader } from '../components/ui';
import { TransactionRow, useNames } from '../components/TransactionRow';

const PAGE_SIZE = 50;
const FILTER_KEYS = Object.keys(transactionFilterSchema.shape) as (keyof TransactionFilter)[];

/** Filter → query string, in a fixed key order so equal filters give equal strings. */
export function filterToQuery(filter: TransactionFilter): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filter[key];
    if (value !== undefined && value !== '' && value !== false) params.set(key, String(value));
  }
  return params.toString();
}

function queryToFilter(params: URLSearchParams): TransactionFilter {
  const raw = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? undefined]));
  const parsed = transactionFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

type Editing = { mode: 'new' } | { mode: 'edit'; transaction: Transaction };

export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const filter = useMemo(() => queryToFilter(params), [params]);
  const query = filterToQuery(filter);
  const setFilter = (next: TransactionFilter) => setParams(new URLSearchParams(filterToQuery(next)), { replace: true });
  const patchFilter = (patch: Partial<TransactionFilter>) => setFilter({ ...filter, ...patch });

  const toast = useToast();
  const save = useSaveTransaction();
  const [editing, setEditing] = useState<Editing>();
  const [formKey, setFormKey] = useState(0);
  const { hidden, remove } = useUndoableDelete(transactionDependents);

  const list = useInfiniteQuery({
    queryKey: [...keys.transactions, 'list', query],
    queryFn: ({ pageParam }) =>
      api<TransactionPage>(`/transactions?${query}${query ? '&' : ''}limit=${PAGE_SIZE}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.count ? loaded : undefined;
    },
  });
  const first = list.data?.pages[0];
  const rows = (list.data?.pages ?? []).flatMap((p) => p.items).filter((t) => !hidden.has(t.id));

  const names = useNames();

  const deleteTransaction = (t: Transaction) => {
    setEditing(undefined);
    remove(t.id, `/transactions/${t.id}`, `transaction of ${formatNok(t.amount)}`);
  };

  return (
    <>
      <PageHeader
        title="Transactions"
        actions={
          <button type="button" className="button button-primary" onClick={() => setEditing({ mode: 'new' })}>
            + Add transaction
          </button>
        }
      />

      <Filters filter={filter} query={query} setFilter={setFilter} patchFilter={patchFilter} />

      {list.isPending ? (
        <Loading />
      ) : list.error ? (
        <ErrorBox error={list.error} />
      ) : rows.length === 0 ? (
        <Empty>{query ? 'No transactions match these filters.' : 'No transactions yet. Add your first one above.'}</Empty>
      ) : (
        <>
          {first && (
            <div className="totals" aria-live="polite">
              <span>
                <strong>{first.count}</strong> {first.count === 1 ? 'transaction' : 'transactions'}
              </span>
              <span>
                Income <span className="amount">{formatNok(first.income)}</span>
              </span>
              <span>
                Expense <span className="amount">{formatNok(first.expense)}</span>
              </span>
              <span>
                Net <strong className={`amount${first.net < 0 ? ' negative' : ''}`}>{formatNok(first.net)}</strong>
              </span>
            </div>
          )}
          <table className="data-table transaction-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Details</th>
                <th>Account</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <TransactionRow key={t.id} t={t} names={names} onOpen={() => setEditing({ mode: 'edit', transaction: t })} />
              ))}
            </tbody>
          </table>
          {list.hasNextPage && (
            <div className="load-more">
              <button type="button" className="button" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}

      {editing && (
        <TransactionForm
          key={formKey}
          title={editing.mode === 'edit' ? 'Edit transaction' : 'New transaction'}
          initial={editing.mode === 'edit' ? toInput(editing.transaction) : undefined}
          allowAddAnother={editing.mode === 'new'}
          onClose={() => setEditing(undefined)}
          onDelete={editing.mode === 'edit' ? () => deleteTransaction(editing.transaction) : undefined}
          save={async (body, addAnother) => {
            await save.mutateAsync({ id: editing.mode === 'edit' ? editing.transaction.id : undefined, body });
            toast.show('Transaction saved');
            if (addAnother) setFormKey((k) => k + 1);
            else setEditing(undefined);
          }}
        />
      )}
    </>
  );
}

function Filters({
  filter,
  query,
  setFilter,
  patchFilter,
}: {
  filter: TransactionFilter;
  query: string;
  setFilter: (f: TransactionFilter) => void;
  patchFilter: (p: Partial<TransactionFilter>) => void;
}) {
  const accounts = useAccounts();
  const categories = useCategories();
  const recipients = useRecipients();
  const tags = useTags();
  const saved = useSavedFilters();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [custom, setCustom] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(filter.q ?? '');
  const removeSaved = useApiMutation((id: number) => api(`/saved-filters/${id}`, { method: 'DELETE' }), [keys.savedFilters]);

  const period: Period | 'all' | 'custom' =
    custom || ((filter.from || filter.to) && !periodOf(filter.from, filter.to)) ? 'custom' : (periodOf(filter.from, filter.to) ?? 'all');
  const activeSaved = (saved.data ?? []).find((s) => filterToQuery(s.filter) === query);
  const categoryValue = filter.uncategorized ? 'none' : (filter.categoryId?.toString() ?? '');
  const id = (v: string) => (v ? Number(v) : undefined);
  const activeCount = (Object.keys(filter) as (keyof TransactionFilter)[]).filter(
    (k) => k !== 'q' && k !== 'to' && filter[k] !== undefined && filter[k] !== false,
  ).length;

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    patchFilter({ q: search.trim() || undefined });
  };

  return (
    <section className={`card filters${open ? ' filters-open' : ''}`}>
      <form className="filter-search" onSubmit={submitSearch} role="search">
        <input
          type="search"
          value={search}
          placeholder="Search recipient, description or memo"
          aria-label="Search transactions"
          onChange={(e) => {
            setSearch(e.target.value);
            if (e.target.value === '' && filter.q) patchFilter({ q: undefined });
          }}
        />
        <button type="submit" className="button search-button">
          Search
        </button>
        <button type="button" className="button filter-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
      </form>
      <div className="filter-grid">
        <label className="field">
          <span className="field-label">Period</span>
          <select
            value={period}
            onChange={(e) => {
              const v = e.target.value;
              setCustom(v === 'custom');
              if (v === 'all') patchFilter({ from: undefined, to: undefined });
              else if (v !== 'custom') patchFilter(periodRange(v as Period));
            }}
          >
            <option value="all">All time</option>
            {(Object.keys(PERIODS) as Period[]).map((p) => (
              <option key={p} value={p}>
                {PERIODS[p]}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </label>
        {period === 'custom' && (
          <>
            <label className="field">
              <span className="field-label">From</span>
              <input type="date" value={filter.from ?? ''} onChange={(e) => patchFilter({ from: e.target.value || undefined })} />
            </label>
            <label className="field">
              <span className="field-label">To</span>
              <input type="date" value={filter.to ?? ''} onChange={(e) => patchFilter({ to: e.target.value || undefined })} />
            </label>
          </>
        )}
        <label className="field">
          <span className="field-label">Account</span>
          <select value={filter.accountId ?? ''} onChange={(e) => patchFilter({ accountId: id(e.target.value) })}>
            <option value="">All accounts</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Category</span>
          <select
            value={categoryValue}
            onChange={(e) =>
              patchFilter(
                e.target.value === 'none'
                  ? { categoryId: undefined, uncategorized: true }
                  : { categoryId: id(e.target.value), uncategorized: undefined },
              )
            }
          >
            <option value="">All categories</option>
            <option value="none">Uncategorised</option>
            {(['expense', 'income'] as const).map((kind) => (
              <optgroup key={kind} label={kind === 'expense' ? 'Expense' : 'Income'}>
                {flattenTree(buildCategoryTree((categories.data ?? []).filter((c) => c.kind === kind))).map((c) => (
                  <option key={c.id} value={c.id}>
                    {'   '.repeat(c.depth)}
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Recipient</span>
          <select value={filter.recipientId ?? ''} onChange={(e) => patchFilter({ recipientId: id(e.target.value) })}>
            <option value="">All recipients</option>
            {(recipients.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Tag</span>
          <select value={filter.tagId ?? ''} onChange={(e) => patchFilter({ tagId: id(e.target.value) })}>
            <option value="">All tags</option>
            {(tags.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Type</span>
          <select value={filter.type ?? ''} onChange={(e) => patchFilter({ type: (e.target.value || undefined) as TransactionFilter['type'] })}>
            <option value="">All types</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </select>
        </label>
      </div>
      <div className="filter-actions">
        <select
          aria-label="Saved filters"
          className="saved-select"
          value={activeSaved?.id ?? ''}
          onChange={(e) => {
            const s = saved.data?.find((x) => x.id === Number(e.target.value));
            if (s) {
              setCustom(false);
              setSearch(s.filter.q ?? '');
              setFilter(s.filter);
            }
          }}
        >
          <option value="">{(saved.data ?? []).length ? 'Saved filters…' : 'No saved filters'}</option>
          {(saved.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {activeSaved ? (
          <button
            type="button"
            className="button button-small button-quiet"
            onClick={() =>
              removeSaved.mutate(activeSaved.id, {
                onSuccess: () => toast.show(`Deleted saved filter ${activeSaved.name}`),
                onError: (err) => toast.show(errorMessage(err), { kind: 'error' }),
              })
            }
          >
            Delete saved filter
          </button>
        ) : (
          query && (
            <button type="button" className="button button-small" onClick={() => setSaving(true)}>
              Save filter
            </button>
          )
        )}
        {query && (
          <button
            type="button"
            className="button button-small button-quiet"
            onClick={() => {
              setCustom(false);
              setSearch('');
              setFilter({});
            }}
          >
            Clear filters
          </button>
        )}
      </div>
      {saving && <SaveFilterDialog filter={filter} onClose={() => setSaving(false)} />}
    </section>
  );
}

function SaveFilterDialog({ filter, onClose }: { filter: TransactionFilter; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const create = useApiMutation((body: unknown) => api<SavedFilter>('/saved-filters', { method: 'POST', body }), [keys.savedFilters]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Name is required');
    create.mutate(
      { name, filter },
      {
        onSuccess: (s) => {
          toast.show(`Saved filter ${s.name}`);
          onClose();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };
  return (
    <Modal title="Save filter" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <Field label="Name" hint="Only you see your saved filters">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} />
        </Field>
        {error && <div className="error-box">{error}</div>}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={create.isPending}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
