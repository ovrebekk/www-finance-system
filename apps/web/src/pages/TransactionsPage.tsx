import { PageHeader } from '../components/ui';

export function TransactionsPage() {
  return (
    <>
      <PageHeader title="Transactions" />
      <section className="card">
        <p>Transaction entry (including split transactions), the filtered list and saved filters are part of phase 2.</p>
        <p className="muted">
          The database already stores transactions, split lines and per-line tags, so accounts, categories, recipients and
          tags set up now are ready to use.
        </p>
      </section>
    </>
  );
}
