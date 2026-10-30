import type { BankFormat } from '@finance/shared';

/** One transaction row of a bank file, in the bank's own terms. */
export interface ParsedBankRow {
  /** Line in the file (the header is line 1). */
  line: number;
  /** YYYY-MM-DD, or null when the bank has not booked the row yet. */
  date: string | null;
  /** Signed øre: negative is money out. */
  amount: number;
  currency: string;
  counterparty: string | null;
  text: string | null;
  bankType: string | null;
  /** The account the file belongs to, when the row shows it. */
  ownAccountNumber: string | null;
  otherAccountNumber: string | null;
  reserved: boolean;
  /** The bank marks the row as a move between accounts. */
  looksLikeTransfer: boolean;
}

/**
 * A bank's CSV export format. To support another bank, add a module that
 * implements this and list it in FORMATS (formats.ts) and BANK_FORMATS
 * (@finance/shared).
 */
export interface BankFormatParser {
  id: BankFormat;
  label: string;
  delimiter: string;
  /** True when the header row is this format's. */
  detect(header: string[]): boolean;
  /** Reads the rows after the header; lines it cannot read go to `problems`. */
  parse(header: string[], rows: { line: number; cells: string[] }[], problems: string[]): ParsedBankRow[];
}

/** Account numbers compared as digits only: "6580.70.56411" = "65807056411". */
export const accountDigits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

/** A Norwegian account number (11 digits, optionally written 1234.56.78901). */
export const isAccountNumber = (v: string) => /^\d{4}\.?\d{2}\.?\d{5}$/.test(v.trim());

export const isRealDate = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
};
