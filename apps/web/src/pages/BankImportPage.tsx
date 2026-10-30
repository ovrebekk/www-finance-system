import { useEffect, useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  categoryKindsFor,
  formatNok,
  type Account,
  type BankImportPreview,
  type BankImportResult,
  type BankImportRow,
  type TransactionInput,
  type TransactionType,
} from '@finance/shared';
import { api, errorMessage, RequestError } from '../lib/api';
import { newClientId } from '../lib/offline';
import { transactionDependents, useAccounts, useCategories, useRecipients } from '../lib/queries';
import { CategorySelect } from '../components/CategorySelect';
import { Empty, Field, Loading, PageHeader } from '../components/ui';

/** One reviewed row: what will be saved, starting from the importer's suggestion. */
interface Draft {
  include: boolean;
  date: string;
  type: TransactionType;
  recipientName: string;
  categoryId: number | null;
  otherAccountId: number | null;
  description: string;
  /** Makes a retried import safe: the server skips rows it already saved. */
  clientId: string;
  /** Edited by hand, so a new preview (another account chosen) leaves it alone. */
  touched: boolean;
}

/** A file being reviewed. Kept on this device so a reload or a detour to another page loses nothing. */
interface Session {
  fileName: string;
  content: string;
  preview: BankImportPreview;
  drafts: Record<number, Draft>;
  saveRecipientDefaults: boolean;
}

const SESSION_KEY = 'finance.bankImport';
const ACCOUNT_MAP_KEY = 'finance.bankImportAccounts';

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function storeSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be full or unavailable; the review still works until the page is left.
  }
}

/** Account number in a bank file → the account it was imported into last time on this device. */
function rememberedAccount(number: string | null): number | undefined {
  if (!number) return undefined;
  try {
    const map = JSON.parse(localStorage.getItem(ACCOUNT_MAP_KEY) ?? '{}') as Record<string, number>;
    return map[number.replace(/\D/g, '')];
  } catch {
    return undefined;
  }
}

function rememberAccountNumber(number: string | null, accountId: number) {
  if (!number) return;
  try {
    const map = JSON.parse(localStorage.getItem(ACCOUNT_MAP_KEY) ?? '{}') as Record<string, number>;
    localStorage.setItem(ACCOUNT_MAP_KEY, JSON.stringify({ ...map, [number.replace(/\D/g, '')]: accountId }));
  } catch {
    // Only a convenience.
  }
}

/** Bank files are UTF-8 today; older exports can be Windows-1252, which shows up as decoding errors. */
async function readText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function draftFrom(row: BankImportRow, clientId = newClientId()): Draft {
  const s = row.suggestion;
  return {
    include: row.duplicateOf === null && !row.reserved,
    date: row.date ?? '',
    type: s.type,
    recipientName: s.recipientName ?? '',
    categoryId: s.categoryId,
    otherAccountId: s.otherAccountId,
    description: s.description ?? '',
    clientId,
    touched: false,
  };
}

/** Why a selected row cannot be saved yet, or null. */
function rowError(d: Draft, accountId: number | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return 'Enter a date';
  if (d.type === 'transfer') {
    if (d.otherAccountId === null) return 'Choose the other account';
    if (d.otherAccountId === accountId) return 'Choose a different account';
  }
  return null;
}

function toTransaction(row: BankImportRow, d: Draft, accountId: number): TransactionInput {
  const amount = Math.abs(row.amount);
  const description = d.description.trim() || null;
  if (d.type === 'transfer') {
    // Money out goes from this account to the other one; money in comes the other way.
    const [from, to] = row.amount < 0 ? [accountId, d.otherAccountId!] : [d.otherAccountId!, accountId];
    return {
      type: 'transfer',
      date: d.date,
      accountId: from,
      toAccountId: to,
      amount,
      description,
      status: row.reserved ? 'pending' : 'cleared',
      clientId: d.clientId,
    };
  }
  return {
    type: d.type,
    date: d.date,
    accountId,
    recipientName: d.recipientName.trim() || null,
    description,
    status: row.reserved ? 'pending' : 'cleared',
    lines: [{ categoryId: d.categoryId, amount, memo: null, tagIds: [] }],
    clientId: d.clientId,
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function BankImportPage() {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const categories = useCategories();
  const recipients = useRecipients();
  const [session, setSession] = useState<Session | null>(loadSession);
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);
  const [error, setError] = useState<{
    message: string;
    details: string[];
  } | null>(null);
  const [done, setDone] = useState<{
    result: BankImportResult;
    accountId: number;
    from: string;
    to: string;
  } | null>(null);
  const [hideUnselected, setHideUnselected] = useState(false);

  useEffect(() => storeSession(session), [session]);

  const fail = (err: unknown) => {
    const details = err instanceof RequestError && Array.isArray(err.details) ? (err.details as string[]) : [];
    setError({ message: errorMessage(err), details });
  };

  const fetchPreview = (content: string, fileName: string, accountId?: number) =>
    api<BankImportPreview>('/import/bank/preview', {
      method: 'POST',
      body: { content, fileName, accountId },
    });

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setDone(null);
    setBusy('reading');
    try {
      const content = await readText(file);
      let preview = await fetchPreview(content, file.name);
      // The server guesses the account from numbers in account names and notes; this device may know better.
      const remembered = rememberedAccount(preview.accountNumber);
      if (preview.accountId === null && remembered !== undefined && accounts.data?.some((a) => a.id === remembered)) {
        preview = await fetchPreview(content, file.name, remembered);
      }
      const drafts = Object.fromEntries(preview.rows.map((r) => [r.line, draftFrom(r)]));
      setSession({
        fileName: file.name,
        content,
        preview,
        drafts,
        saveRecipientDefaults: true,
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  /** A new account changes which rows are duplicates and which are transfers, so the untouched rows are suggested again. */
  const chooseAccount = async (accountId: number) => {
    if (!session) return;
    setError(null);
    setBusy('reading');
    try {
      const preview = await fetchPreview(session.content, session.fileName, accountId);
      rememberAccountNumber(preview.accountNumber, accountId);
      const drafts = Object.fromEntries(
        preview.rows.map((r) => {
          const old = session.drafts[r.line];
          return [r.line, old?.touched ? old : draftFrom(r, old?.clientId)];
        }),
      );
      setSession({ ...session, preview, drafts });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const update = (line: number, patch: Partial<Draft>) =>
    setSession((s) => {
      if (!s) return s;
      const current = s.drafts[line]!;
      const next = { ...current, ...patch, touched: true };
      const drafts = { ...s.drafts, [line]: next };
      // A category chosen for one row fills in the other rows from the same recipient that have none.
      if (patch.categoryId != null && next.recipientName.trim()) {
        for (const [key, d] of Object.entries(drafts)) {
          if (Number(key) !== line && d.categoryId === null && d.type === next.type && sameName(d.recipientName, next.recipientName)) {
            drafts[Number(key)] = { ...d, categoryId: patch.categoryId };
          }
        }
      }
      return { ...s, drafts };
    });

  const setAll = (include: boolean) =>
    setSession((s) =>
      s
        ? {
            ...s,
            drafts: Object.fromEntries(Object.entries(s.drafts).map(([k, d]) => [k, { ...d, include }])),
          }
        : s,
    );

  const discard = () => {
    if (!window.confirm('Discard this import? Your changes to the rows are lost; nothing has been saved.')) return;
    setSession(null);
    setError(null);
  };

  const rows = session?.preview.rows ?? [];
  const accountId = session?.preview.accountId ?? null;
  const selected = rows.filter((r) => session?.drafts[r.line]?.include);
  const invalid = selected.filter((r) => rowError(session!.drafts[r.line]!, accountId) !== null).length;
  const totals = { out: 0, into: 0 };
  for (const r of selected) {
    if (r.amount < 0) totals.out -= r.amount;
    else totals.into += r.amount;
  }

  const commit = async () => {
    if (!session || accountId === null) return;
    setError(null);
    setBusy('saving');
    try {
      const body = {
        rows: selected.map((r) => ({
          line: r.line,
          transaction: toTransaction(r, session.drafts[r.line]!, accountId),
        })),
        saveRecipientDefaults: session.saveRecipientDefaults,
      };
      const result = await api<BankImportResult>('/import/bank/commit', {
        method: 'POST',
        body,
      });
      const dates = selected.map((r) => session.drafts[r.line]!.date).sort();
      setDone({
        result,
        accountId,
        from: dates[0]!,
        to: dates[dates.length - 1]!,
      });
      setSession(null);
      for (const key of transactionDependents) void qc.invalidateQueries({ queryKey: key });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  if (accounts.isPending || categories.isPending) return <Loading />;
  const accountList = (accounts.data ?? []).filter((a) => !a.archived || a.id === accountId);
  const accountName = (id: number | null) => accounts.data?.find((a) => a.id === id)?.name;

  return (
    <>
      <PageHeader title="Import from bank" actions={<Link to="/transactions">Back to transactions</Link>} />

      {error && (
        <div className="error-box">
          {error.message}
          {error.details.length > 0 && (
            <ul className="small">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {done && (
        <section className="card">
          <h2>Imported</h2>
          <p>
            {done.result.created === 1 ? '1 transaction was' : `${done.result.created} transactions were`} added to{' '}
            {accountName(done.accountId)}.
            {done.result.recipientsCreated > 0 && ` ${done.result.recipientsCreated} new recipients were created.`}
            {done.result.defaultsSaved > 0 && ` ${done.result.defaultsSaved} recipients got a default category.`}
          </p>
          <Link className="button button-primary" to={`/transactions?from=${done.from}&to=${done.to}&accountId=${done.accountId}`}>
            Show the imported transactions
          </Link>
        </section>
      )}

      {!session && (
        <section className="card">
          <h2>Choose a file</h2>
          <p className="muted">
            Download the transactions as CSV from the bank's website and choose the file here. You can check and change every row before
            anything is saved. Supported: <strong>Nordea</strong>.
          </p>
          <label className="button button-primary">
            {busy === 'reading' ? 'Reading…' : 'Choose CSV file…'}
            <input type="file" className="sr-only" accept=".csv,.txt,text/csv" disabled={busy !== null} onChange={choose} />
          </label>
        </section>
      )}

      {session && (
        <>
          <section className="card">
            <div className="card-header">
              <h2>
                {session.preview.formatLabel} · {session.fileName}
              </h2>
              <button type="button" className="button button-quiet button-small" onClick={discard} disabled={busy !== null}>
                Discard
              </button>
            </div>
            <div className="field-row">
              <Field
                label="Import into account"
                error={accountId === null ? 'Choose the account this file is from' : undefined}
                hint={
                  session.preview.accountNumber
                    ? `The file is from account ${session.preview.accountNumber}. Put that number in the account's name or notes and it is chosen for you.`
                    : undefined
                }
              >
                <select
                  value={accountId ?? ''}
                  disabled={busy !== null}
                  onChange={(e) => e.target.value && void chooseAccount(Number(e.target.value))}
                >
                  <option value="">— Choose —</option>
                  {accountList.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {session.preview.problems.length > 0 && (
              <details className="small">
                <summary>
                  {session.preview.problems.length} {session.preview.problems.length === 1 ? 'line was' : 'lines were'} left out
                </summary>
                <ul>
                  {session.preview.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <div className="toolbar">
            <span>
              <strong>{selected.length}</strong> of {rows.length} rows selected · out {formatNok(totals.out)} · in {formatNok(totals.into)}
            </span>
            <button type="button" className="button button-small" onClick={() => setAll(true)}>
              Select all
            </button>
            <button type="button" className="button button-small" onClick={() => setAll(false)}>
              Select none
            </button>
            <label className="checkbox small">
              <input type="checkbox" checked={hideUnselected} onChange={(e) => setHideUnselected(e.target.checked)} />
              Hide rows not selected
            </label>
          </div>
          <p className="muted small">
            Rows that look like they are already saved, and reserved rows, start unselected. Choosing a category fills it in for the other
            rows from the same recipient. Splits and tags can be added on the Transactions page afterwards.
          </p>

          {rows.length === 0 ? (
            <Empty>The file has no transactions.</Empty>
          ) : (
            <div className="table-scroll">
              <table className="data-table import-table">
                <thead>
                  <tr>
                    <th aria-label="Import" />
                    <th>Date</th>
                    <th className="num">Amount</th>
                    <th>Type</th>
                    <th>Recipient / account</th>
                    <th>Category</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => !hideUnselected || session.drafts[r.line]!.include)
                    .map((r) => (
                      <ImportRow
                        key={r.line}
                        row={r}
                        draft={session.drafts[r.line]!}
                        accountId={accountId}
                        accounts={accountList}
                        categories={categories.data ?? []}
                        onChange={(patch) => update(r.line, patch)}
                      />
                    ))}
                </tbody>
              </table>
            </div>
          )}
          <datalist id="import-recipients">
            {(recipients.data ?? [])
              .filter((r) => !r.archived)
              .map((r) => (
                <option key={r.id} value={r.name} />
              ))}
          </datalist>

          <section className="card">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={session.saveRecipientDefaults}
                onChange={(e) =>
                  setSession({
                    ...session,
                    saveRecipientDefaults: e.target.checked,
                  })
                }
              />
              Use the categories chosen here as defaults for recipients that have none, so the next import suggests them
            </label>
            <div className="form-actions">
              {invalid > 0 && (
                <span className="field-message">{invalid === 1 ? '1 selected row needs' : `${invalid} selected rows need`} attention</span>
              )}
              <button
                type="button"
                className="button button-primary"
                disabled={busy !== null || accountId === null || selected.length === 0 || invalid > 0}
                onClick={commit}
              >
                {busy === 'saving' ? 'Importing…' : `Import ${selected.length} ${selected.length === 1 ? 'transaction' : 'transactions'}`}
              </button>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function ImportRow({
  row,
  draft,
  accountId,
  accounts,
  categories,
  onChange,
}: {
  row: BankImportRow;
  draft: Draft;
  accountId: number | null;
  accounts: Account[];
  categories: Parameters<typeof CategorySelect>[0]['categories'];
  onChange: (patch: Partial<Draft>) => void;
}) {
  const problem = draft.include ? rowError(draft, accountId) : null;
  const otherAccount = row.otherAccountNumber ? `${row.amount < 0 ? 'to' : 'from'} account ${row.otherAccountNumber}` : null;
  const bankSays = [row.bankType, row.counterparty !== draft.recipientName ? row.counterparty : null, row.text, otherAccount]
    .filter(Boolean)
    .join(' · ');
  const setType = (type: TransactionType) => {
    const kind = categories.find((c) => c.id === draft.categoryId)?.kind;
    onChange({ type, categoryId: kind && categoryKindsFor(type).includes(kind) ? draft.categoryId : null });
  };

  return (
    <tr className={draft.include ? undefined : 'excluded'}>
      <td data-label="Import">
        <input
          type="checkbox"
          aria-label={`Import line ${row.line}`}
          checked={draft.include}
          onChange={(e) => onChange({ include: e.target.checked })}
        />
      </td>
      <td data-label="Date">
        <input
          type="date"
          value={draft.date}
          onChange={(e) => onChange({ date: e.target.value })}
          aria-invalid={problem === 'Enter a date'}
        />
      </td>
      <td className="num" data-label="Amount">
        <span className={`amount${row.amount < 0 ? ' negative' : ''}`}>{formatNok(row.amount)}</span>
      </td>
      <td data-label="Type">
        <select value={draft.type} onChange={(e) => setType(e.target.value as TransactionType)}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="transfer">{row.amount < 0 ? 'Transfer to' : 'Transfer from'}</option>
        </select>
      </td>
      <td data-label={draft.type === 'transfer' ? 'Account' : 'Recipient'}>
        {draft.type === 'transfer' ? (
          <select
            value={draft.otherAccountId ?? ''}
            onChange={(e) =>
              onChange({
                otherAccountId: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">— Choose —</option>
            {accounts
              .filter((a) => a.id !== accountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        ) : (
          <input list="import-recipients" value={draft.recipientName} onChange={(e) => onChange({ recipientName: e.target.value })} />
        )}
      </td>
      <td data-label="Category">
        {draft.type !== 'transfer' && (
          <CategorySelect
            categories={categories}
            kind={categoryKindsFor(draft.type)}
            value={draft.categoryId}
            onChange={(categoryId) => onChange({ categoryId })}
            emptyLabel="— Uncategorised —"
          />
        )}
      </td>
      <td data-label="Description">
        <input value={draft.description} onChange={(e) => onChange({ description: e.target.value })} />
        <div className="import-notes small">
          {row.duplicateOf !== null && <span className="badge badge-warn">Already saved?</span>}
          {bankSays && <span className="muted">{bankSays}</span>}
          {row.warnings.map((w) => (
            <span key={w} className="muted">
              {w}
            </span>
          ))}
          {problem && <span className="field-message">{problem}</span>}
        </div>
      </td>
    </tr>
  );
}
