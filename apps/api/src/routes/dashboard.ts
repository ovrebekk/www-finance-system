import type { FastifyInstance } from 'fastify';
import { dashboardQuerySchema, type CategoryTotal, type Dashboard, type MonthSummary } from '@finance/shared';
import type { AppContext } from '../lib/context.js';
import { loadTransactions } from '../lib/transactions.js';

/** "2026-10" shifted by `delta` months. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The current month in the server's time zone (TZ, Europe/Oslo in production). */
export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function dashboardRoutes(app: FastifyInstance, ctx: AppContext) {
  const { sqlite, guards } = ctx;
  const monthTotals = sqlite.prepare(
    `SELECT substr(date, 1, 7) AS month,
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
     FROM transactions WHERE date >= ? AND date < ? GROUP BY 1`,
  );
  const expenseLines = sqlite.prepare(
    `SELECT l.category_id AS categoryId, SUM(l.amount) AS amount
     FROM transactions t JOIN transaction_lines l ON l.transaction_id = t.id
     WHERE t.type = 'expense' AND t.date >= ? AND t.date < ? GROUP BY l.category_id`,
  );
  const categoryParents = sqlite.prepare('SELECT id, parent_id AS parentId FROM categories');
  const recentIds = sqlite.prepare('SELECT id FROM transactions ORDER BY date DESC, id DESC LIMIT 8');

  app.get('/api/v1/dashboard', { preHandler: guards.requirePermission('transactions:read') }, async (req): Promise<Dashboard> => {
    const month = dashboardQuerySchema.parse(req.query).month ?? currentMonth();
    const start = (m: string) => `${m}-01`;
    const trendStart = addMonths(month, -5);
    const next = addMonths(month, 1);

    const rows = monthTotals.all(start(trendStart), start(next)) as { month: string; income: number; expense: number }[];
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const summary = (m: string): MonthSummary => {
      const r = byMonth.get(m) ?? { income: 0, expense: 0 };
      return { month: m, income: r.income, expense: r.expense, net: r.income - r.expense };
    };
    const trend = Array.from({ length: 6 }, (_, i) => summary(addMonths(trendStart, i)));

    // Roll expense lines up to their top-level category.
    const parents = new Map(
      (categoryParents.all() as { id: number; parentId: number | null }[]).map((c) => [c.id, c.parentId]),
    );
    const rootOf = (id: number) => {
      let current = id;
      for (let guard = 0; guard < 50; guard++) {
        const parent = parents.get(current);
        if (parent == null) return current;
        current = parent;
      }
      return current;
    };
    const totals = new Map<number | null, number>();
    for (const line of expenseLines.all(start(month), start(next)) as CategoryTotal[]) {
      const key = line.categoryId == null ? null : rootOf(line.categoryId);
      totals.set(key, (totals.get(key) ?? 0) + line.amount);
    }
    const expenseByCategory = [...totals]
      .map(([categoryId, amount]) => ({ categoryId, amount }))
      .sort((a, b) => b.amount - a.amount);

    const recent = loadTransactions(
      sqlite,
      (recentIds.all() as { id: number }[]).map((r) => r.id),
    );

    return { month, current: summary(month), previous: summary(addMonths(month, -1)), expenseByCategory, trend, recent };
  });
}
