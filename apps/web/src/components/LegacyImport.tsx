import { useState, type ChangeEvent, type InputHTMLAttributes } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  LEGACY_EXPORT_FILES,
  type LegacyExportFile,
  type LegacyImportReport,
  type LegacyImportTable,
} from '@finance/shared';
import { api, errorMessage, RequestError } from '../lib/api';
import { transactionDependents } from '../lib/queries';

type Files = Partial<Record<LegacyExportFile, string>>;

const TABLE_LABELS: Record<LegacyImportTable, string> = {
  accounts: 'Accounts',
  categories: 'Categories',
  recipients: 'Recipients',
  tags: 'Tags',
  transactions: 'Transactions',
  lines: 'Transaction lines',
  lineTags: 'Line tags',
};

const REQUIRED = LEGACY_EXPORT_FILES.filter((f) => f !== 'transaction_line_tags.csv');
const folderProps = { webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>;

/** Reads the chosen export files; files under raw/ are table dumps the importer does not use. */
async function readExport(list: FileList): Promise<Files> {
  const files: Files = {};
  for (const file of Array.from(list)) {
    const path = file.webkitRelativePath || file.name;
    if (path.split('/').includes('raw')) continue;
    if ((LEGACY_EXPORT_FILES as readonly string[]).includes(file.name)) files[file.name as LegacyExportFile] = await file.text();
  }
  return files;
}

function Report({ report }: { report: LegacyImportReport }) {
  return (
    <>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th className="num">In file</th>
            <th className="num">New</th>
            <th className="num">Merged</th>
            <th className="num">Already here</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(TABLE_LABELS) as LegacyImportTable[]).map((t) => {
            const c = report.counts[t];
            return (
              <tr key={t}>
                <td data-label="Name">
                  <strong>{TABLE_LABELS[t]}</strong>
                </td>
                <td className="num" data-label="In file">{c.rows}</td>
                <td className="num" data-label="New">{c.created}</td>
                <td className="num" data-label="Merged">{c.merged}</td>
                <td className="num" data-label="Already here">{c.skipped}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {report.notes.length > 0 && (
        <details className="small">
          <summary>
            {report.notes.length} {report.notes.length === 1 ? 'note' : 'notes'} on merged items
          </summary>
          <ul>
            {report.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
      {report.exportWarnings > 0 && (
        <p className="muted small">
          The old app wrote {report.exportWarnings} warnings while exporting (refunds left uncategorised, zero amounts left
          out and so on). They are listed in export-summary.txt.
        </p>
      )}
    </>
  );
}

/** Settings card: import the CSV export folder of the old PersonalFinanceWPF app, with a preview first. */
export function LegacyImport() {
  const qc = useQueryClient();
  const [files, setFiles] = useState<Files | null>(null);
  const [preview, setPreview] = useState<LegacyImportReport | null>(null);
  const [done, setDone] = useState<LegacyImportReport | null>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (chosen: Files, dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      return await api<LegacyImportReport>('/import/legacy', { method: 'POST', body: { files: chosen, dryRun } });
    } catch (err) {
      const details = err instanceof RequestError && Array.isArray(err.details) ? (err.details as string[]) : [];
      setError({ message: errorMessage(err), details });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    setPreview(null);
    setDone(null);
    setError(null);
    if (!list?.length) return;
    const chosen = await readExport(list);
    e.target.value = '';
    const missing = REQUIRED.filter((f) => chosen[f] === undefined);
    setFiles(chosen);
    if (missing.length) {
      setError({ message: `These files are missing: ${missing.join(', ')}. Choose the whole finance-export-… folder.`, details: [] });
      return;
    }
    setPreview(await send(chosen, true));
  };

  const runImport = async () => {
    if (!files) return;
    const report = await send(files, false);
    if (!report) return;
    setDone(report);
    setPreview(null);
    setFiles(null);
    for (const key of transactionDependents) void qc.invalidateQueries({ queryKey: key });
  };

  const newTransactions = preview?.counts.transactions.created ?? 0;

  return (
    <section className="card">
      <h2>Import from the old app</h2>
      <p className="muted">
        Choose the <code>finance-export-…</code> folder that <strong>File → Export to CSV</strong> in the old PersonalFinanceWPF app
        wrote. You see what will be imported before anything is saved. Items already imported are skipped, so importing the same
        folder twice does no harm.
      </p>
      <div className="toolbar">
        <label className="button">
          Choose folder…
          <input type="file" className="sr-only" multiple disabled={busy} onChange={choose} {...folderProps} />
        </label>
        <label className="button button-quiet">
          Choose files…
          <input type="file" className="sr-only" multiple accept=".csv,.txt" disabled={busy} onChange={choose} />
        </label>
      </div>
      {busy && <p className="muted">{preview ? 'Importing…' : 'Checking the export…'}</p>}

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

      {preview && (
        <>
          <h3>Preview</h3>
          <Report report={preview} />
          <div className="form-actions">
            <button type="button" className="button" disabled={busy} onClick={() => setPreview(null)}>
              Cancel
            </button>
            <button type="button" className="button button-primary" disabled={busy} onClick={runImport}>
              {newTransactions === 0 ? 'Import (nothing new)' : `Import ${newTransactions} transactions`}
            </button>
          </div>
        </>
      )}

      {done && (
        <>
          <h3>Imported</h3>
          <Report report={done} />
          <p className="muted small">
            Opening balances are 0, as in the old app. Set them on the Accounts page if the balances should match the bank.
          </p>
        </>
      )}
    </section>
  );
}
