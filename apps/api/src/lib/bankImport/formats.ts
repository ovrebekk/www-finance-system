import type { BankFormat } from '@finance/shared';
import { parseCsv } from '../csv.js';
import type { BankFormatParser } from './format.js';
import { nordea } from './nordea.js';

export const FORMATS: Record<BankFormat, BankFormatParser> = { nordea };

/** Splits the file with each format's delimiter and returns the first whose header it recognises. */
export function detectFormat(content: string, wanted?: BankFormat) {
  const candidates = wanted ? [FORMATS[wanted]] : Object.values(FORMATS);
  for (const format of candidates) {
    const table = parseCsv(content, format.delimiter);
    const header = (table[0] ?? []).map((h) => h.trim());
    if (format.detect(header)) return { format, header, table };
  }
  return null;
}
