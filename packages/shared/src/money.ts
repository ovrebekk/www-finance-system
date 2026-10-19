/** Amounts are stored as integers in øre (1 NOK = 100 øre). */

const formatter = new Intl.NumberFormat('nb-NO', {
  style: 'currency',
  currency: 'NOK',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const plainFormatter = new Intl.NumberFormat('nb-NO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123456 → "kr 1 234,56" (nb-NO formatting, non-breaking spaces normalised). */
export function formatNok(ore: number): string {
  return formatter.format(ore / 100).replace(/ | /g, ' ');
}

/** 123456 → "1 234,56" (for input fields). */
export function formatAmount(ore: number): string {
  return plainFormatter.format(ore / 100).replace(/ | /g, ' ');
}

/**
 * Parses user input such as "1 234,50", "1234.5", "-12", "kr 99" into øre.
 * Norwegian conventions: comma is the decimal separator; a dot followed by
 * exactly three digits is a thousands separator. Returns null when invalid.
 */
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(/^kr\.?\s*/i, '').replace(/[\s\u00a0\u202f]/g, '');
  if (s === '') return null;
  const negative = s.startsWith('-') || s.startsWith('\u2212');
  if (negative) s = s.slice(1);

  let intPart = s;
  let fracPart = '';
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  const splitAt = (i: number) => {
    intPart = s.slice(0, i).replace(/[.,]/g, '');
    fracPart = s.slice(i + 1);
  };
  if (commas > 0 && dots > 0) {
    splitAt(Math.max(s.lastIndexOf(','), s.lastIndexOf('.')));
  } else if (commas === 1) {
    splitAt(s.indexOf(','));
  } else if (dots === 1 && !/\.\d{3}$/.test(s)) {
    splitAt(s.indexOf('.'));
  } else {
    intPart = s.replace(/[.,]/g, '');
  }

  if (!/^\d+$/.test(intPart || '0') || !/^\d{0,2}$/.test(fracPart)) return null;
  const ore = Number(intPart || '0') * 100 + Number((fracPart + '00').slice(0, 2));
  if (!Number.isSafeInteger(ore)) return null;
  return negative ? -ore : ore;
}
