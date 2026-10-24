import { parseRupees, type Paise, paise } from '@/lib/money';

export interface BankLine {
  date: string;
  description: string;
  creditPaise: Paise;
  debitPaise: Paise;
  reference: string;
}

export interface ColumnMapping {
  date: string;
  description: string;
  credit: string;
  debit: string;
  reference: string;
}

export type CsvRow = Record<string, string>;

/** Minimal RFC 4180 parser: quotes, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const GUESS: Record<keyof ColumnMapping, RegExp> = {
  date: /^(txn\s*)?(value\s*)?date|^date/i,
  description: /desc|narration|particulars|remarks/i,
  credit: /credit|deposit|\bcr\b/i,
  debit: /debit|withdraw|\bdr\b/i,
  reference: /ref|utr|chq|cheque|instrument/i,
};

/** Best-effort column mapping from header names; the owner can override each. */
export function guessMapping(headers: string[]): Partial<ColumnMapping> {
  const out: Partial<ColumnMapping> = {};
  for (const key of Object.keys(GUESS) as (keyof ColumnMapping)[]) {
    const h = headers.find((x) => GUESS[key].test(x.trim()));
    if (h) out[key] = h;
  }
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd, dd-Mon-yyyy to ISO. Null when it is not a date. */
export function parseBankDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])] as [number, number, number];
  else if ((r = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/.exec(s))) {
    d = Number(r[1]);
    m = Number(r[2]);
    y = r[3]!.length === 2 ? 2000 + Number(r[3]) : Number(r[3]);
  } else if ((r = /^(\d{1,2})[-/ ]([A-Za-z]{3})[a-z]*[-/ ](\d{2}|\d{4})$/.exec(s))) {
    d = Number(r[1]);
    m = MONTHS.indexOf(r[2]!.toLowerCase()) + 1;
    y = r[3]!.length === 2 ? 2000 + Number(r[3]) : Number(r[3]);
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

function amount(raw: string | undefined): Paise | null {
  const s = (raw ?? '').replace(/(cr|dr)\.?$/i, '').trim();
  if (s === '' || s === '-') return paise(0);
  try {
    return parseRupees(s);
  } catch {
    return null;
  }
}

export interface BankParse {
  lines: BankLine[];
  errors: { row: number; message: string }[];
}

export function parseBankCsv(text: string, mapping: ColumnMapping): BankParse {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  const idx = (name: string) => header.findIndex((h) => h.trim() === name.trim());
  const col = {
    date: idx(mapping.date),
    description: idx(mapping.description),
    credit: idx(mapping.credit),
    debit: idx(mapping.debit),
    reference: mapping.reference ? idx(mapping.reference) : -1,
  };
  const errors: BankParse['errors'] = [];
  for (const k of ['date', 'description', 'credit', 'debit'] as const) {
    if (col[k] < 0) errors.push({ row: 1, message: `Column "${mapping[k]}" not found for ${k}.` });
  }
  if (errors.length) return { lines: [], errors };
  const lines: BankLine[] = [];
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const date = parseBankDate(r[col.date] ?? '');
    const credit = amount(r[col.credit]);
    const debit = amount(r[col.debit]);
    if (!date)
      return void errors.push({ row: rowNo, message: `Unreadable date "${r[col.date] ?? ''}".` });
    if (credit === null || debit === null)
      return void errors.push({ row: rowNo, message: 'Unreadable amount.' });
    if (credit < 0 || debit < 0)
      return void errors.push({ row: rowNo, message: 'Negative amount.' });
    if (credit > 0 && debit > 0)
      return void errors.push({ row: rowNo, message: 'Both credit and debit filled.' });
    if (credit === 0 && debit === 0) return void errors.push({ row: rowNo, message: 'No amount.' });
    lines.push({
      date,
      description: (r[col.description] ?? '').trim(),
      creditPaise: credit,
      debitPaise: debit,
      reference: col.reference >= 0 ? (r[col.reference] ?? '').trim() : '',
    });
  });
  return { lines, errors };
}

/**
 * Stable per-line key from date + amount + reference (+ nth occurrence of an identical line within
 * the same file), so re-importing a file never double counts but two real identical lines both land.
 */
export function dedupeKeys(lines: BankLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = `${l.date}|${l.creditPaise}|${l.debitPaise}|${l.reference.toLowerCase().replace(/\s+/g, '')}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
