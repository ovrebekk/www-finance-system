const pad = (n: number) => String(n).padStart(2, '0');

/** Local date as YYYY-MM-DD. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoDay(new Date());

/** Local month as YYYY-MM. */
export const isoMonth = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

export const PERIODS = {
  thisMonth: 'This month',
  lastMonth: 'Last month',
  last3Months: 'Last 3 months',
  thisYear: 'This year',
  lastYear: 'Last year',
} as const;
export type Period = keyof typeof PERIODS;

/** Date range of a named period, relative to `now`. */
export function periodRange(period: Period, now = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case 'thisMonth':
      return { from: isoDay(new Date(y, m, 1)), to: isoDay(new Date(y, m + 1, 0)) };
    case 'lastMonth':
      return { from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)) };
    case 'last3Months':
      return { from: isoDay(new Date(y, m - 2, 1)), to: isoDay(new Date(y, m + 1, 0)) };
    case 'thisYear':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'lastYear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  }
}

/** The named period that matches a range exactly, if any. */
export function periodOf(from?: string, to?: string, now = new Date()): Period | undefined {
  return (Object.keys(PERIODS) as Period[]).find((p) => {
    const r = periodRange(p, now);
    return r.from === from && r.to === to;
  });
}

const dayFormat = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
const monthFormat = new Intl.DateTimeFormat('nb-NO', { month: 'long', year: 'numeric' });
const shortMonthFormat = new Intl.DateTimeFormat('nb-NO', { month: 'short' });

/** "2026-10-05" → "5. okt. 2026" */
export const formatDay = (iso: string) => dayFormat.format(new Date(`${iso}T12:00:00`));
/** "2026-10" → "oktober 2026" */
export const formatMonth = (month: string) => monthFormat.format(new Date(`${month}-15T12:00:00`));
/** "2026-10" → "okt." */
export const formatShortMonth = (month: string) => shortMonthFormat.format(new Date(`${month}-15T12:00:00`));
