import { parseAmount } from '@finance/shared';
import { isAccountNumber, isRealDate, type BankFormatParser, type ParsedBankRow } from './format.js';

const COLUMNS = ['Bokføringsdato', 'Beløp', 'Avsender', 'Mottaker', 'Navn', 'Tittel', 'Valuta', 'Betalingstype'] as const;
type Column = (typeof COLUMNS)[number];

/** Nordea writes "Reservert" in the date column for rows that are not booked yet. */
const RESERVED = /^reservert$/i;
/** Payment types Nordea uses for moves between accounts. */
const ACCOUNT_IN_TEXT = /\b\d{4}\.\d{2}\.\d{5}\b/;
const TRANSFER_TYPES = /^(kontoregulering|overføring egen konto)$/i;

/** "2026/03/30", "2026-03-30" or "30.03.2026" → "2026-03-30". */
function toIsoDate(v: string): string | null {
  const s = v.trim();
  const ymd = /^(\d{4})[/.-](\d{2})[/.-](\d{2})$/.exec(s);
  const dmy = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  const iso = ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : null;
  return iso && isRealDate(iso) ? iso : null;
}

const clean = (v: string | undefined) => {
  const s = (v ?? '').replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
};

/**
 * Nordea netbank export ("Last ned transaksjoner", CSV): semicolon
 * separated, UTF-8 with BOM, comma decimals, one row per booked or reserved
 * transaction. Avsender is our account on money out, Mottaker on money in.
 */
export const nordea: BankFormatParser = {
  id: 'nordea',
  label: 'Nordea',
  delimiter: ';',
  detect: (header) => ['Bokføringsdato', 'Beløp', 'Tittel'].every((c) => header.includes(c)),
  parse(header, rows, problems) {
    const missing = COLUMNS.filter((c) => !header.includes(c));
    if (missing.length) {
      problems.push(`The file lacks the column(s) ${missing.join(', ')}`);
      return [];
    }
    const index = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<Column, number>;
    const out: ParsedBankRow[] = [];
    for (const { line, cells } of rows) {
      const get = (c: Column) => cells[index[c]] ?? '';
      const rawDate = get('Bokføringsdato').trim();
      const reserved = RESERVED.test(rawDate);
      const date = reserved ? null : toIsoDate(rawDate);
      if (!reserved && !date) {
        problems.push(`Line ${line}: '${rawDate}' is not a date`);
        continue;
      }
      const amount = parseAmount(get('Beløp'));
      if (amount === null) {
        problems.push(`Line ${line}: '${get('Beløp')}' is not an amount`);
        continue;
      }
      if (amount === 0) {
        problems.push(`Line ${line}: the amount is 0, so the row was left out`);
        continue;
      }
      const sender = clean(get('Avsender'));
      const receiver = clean(get('Mottaker'));
      const name = clean(get('Navn'));
      let title = clean(get('Tittel'));
      let other = amount < 0 ? receiver : sender;
      // Transfers to an account without a name show the account number as the title.
      if (title && isAccountNumber(title)) {
        other ??= title;
        title = null;
      }
      // Loan payments name the loan account in the title: "BETALING PÅ LÅN 1234.56.78901".
      other ??= (title && ACCOUNT_IN_TEXT.exec(title)?.[0]) || null;
      const bankType = clean(get('Betalingstype'));
      out.push({
        line,
        date,
        amount,
        currency: clean(get('Valuta')) ?? 'NOK',
        counterparty: name ?? title,
        text: name ? title : null,
        bankType,
        ownAccountNumber: amount < 0 ? sender : receiver,
        otherAccountNumber: other,
        reserved,
        looksLikeTransfer: bankType !== null && TRANSFER_TYPES.test(bankType),
      });
    }
    return out;
  },
};
