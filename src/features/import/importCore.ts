import * as XLSX from 'xlsx';
import { addDays, assertISODate, fiscalYearOf, type ISODate } from '@/lib/dates';
import { placeOfSupply } from '@/lib/gst';
import { validateGstin } from '@/lib/gstin';
import { formatINR, paise, parseRupees, type Paise } from '@/lib/money';

/** Hard limit so a huge or hostile file cannot freeze the browser. */
export const MAX_IMPORT_ROWS = 5000;

export interface Sheet {
  headers: string[];
  rows: string[][];
}

/** Reads CSV or Excel (first sheet) into text cells. Dates become yyyy-mm-dd. */
export function readSheet(data: ArrayBuffer | string, isCsv: boolean): Sheet {
  const wb = isCsv
    ? XLSX.read(data, { type: typeof data === 'string' ? 'string' : 'array', raw: true })
    : XLSX.read(data, { type: 'array', cellDates: true });
  const name = wb.SheetNames[0];
  if (!name) return { headers: [], rows: [] };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, {
    header: 1,
    raw: false,
    dateNF: 'yyyy-mm-dd',
    blankrows: false,
  });
  const cell = (c: unknown) => (c === undefined || c === null ? '' : String(c).trim());
  const [head, ...body] = grid;
  return {
    headers: (head ?? []).map(cell),
    rows: body.slice(0, MAX_IMPORT_ROWS).map((r) => (r ?? []).map(cell)),
  };
}

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  /** Lower-case header names that map to this field automatically. */
  aliases: string[];
}

export const CUSTOMER_FIELDS: FieldDef[] = [
  {
    key: 'name',
    label: 'Name',
    required: true,
    aliases: ['name', 'customer', 'customer name', 'party', 'party name', 'ledger'],
  },
  {
    key: 'gstin',
    label: 'GSTIN',
    required: false,
    aliases: ['gstin', 'gst no', 'gst number', 'gstin/uin'],
  },
  {
    key: 'phone',
    label: 'Phone',
    required: false,
    aliases: ['phone', 'mobile', 'contact', 'phone number'],
  },
  { key: 'email', label: 'Email', required: false, aliases: ['email', 'e-mail', 'email id'] },
  { key: 'address', label: 'Address', required: false, aliases: ['address'] },
  {
    key: 'credit_days',
    label: 'Credit days',
    required: false,
    aliases: ['credit days', 'credit period', 'terms'],
  },
];

export const INVOICE_FIELDS: FieldDef[] = [
  {
    key: 'number',
    label: 'Invoice number',
    required: true,
    aliases: [
      'invoice number',
      'invoice no',
      'invoice no.',
      'inv no',
      'number',
      'voucher no',
      'bill no',
    ],
  },
  {
    key: 'date',
    label: 'Invoice date',
    required: true,
    aliases: ['invoice date', 'date', 'bill date'],
  },
  { key: 'dueDate', label: 'Due date', required: false, aliases: ['due date', 'due'] },
  {
    key: 'customerName',
    label: 'Customer name',
    required: true,
    aliases: ['customer', 'customer name', 'party', 'party name', 'buyer'],
  },
  {
    key: 'customerGstin',
    label: 'Customer GSTIN',
    required: false,
    aliases: ['customer gstin', 'gstin', 'party gstin', 'buyer gstin'],
  },
  {
    key: 'taxable',
    label: 'Taxable amount',
    required: false,
    aliases: ['taxable', 'taxable amount', 'taxable value', 'sub total', 'subtotal'],
  },
  { key: 'cgst', label: 'CGST', required: false, aliases: ['cgst', 'cgst amount'] },
  { key: 'sgst', label: 'SGST', required: false, aliases: ['sgst', 'sgst amount', 'utgst'] },
  { key: 'igst', label: 'IGST', required: false, aliases: ['igst', 'igst amount'] },
  {
    key: 'total',
    label: 'Total amount',
    required: true,
    aliases: ['total', 'total amount', 'invoice total', 'grand total', 'amount'],
  },
];

/** field key -> column index (or -1 when unmapped). */
export type Mapping = Record<string, number>;

export function guessMapping(headers: string[], fields: FieldDef[]): Mapping {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const used = new Set<number>();
  const m: Mapping = {};
  for (const f of fields) {
    let idx = -1;
    for (const a of f.aliases) {
      const i = lower.findIndex((h, n) => h === a && !used.has(n));
      if (i >= 0) {
        idx = i;
        break;
      }
    }
    m[f.key] = idx;
    if (idx >= 0) used.add(idx);
  }
  return m;
}

export function missingRequired(mapping: Mapping, fields: FieldDef[]): string[] {
  return fields.filter((f) => f.required && (mapping[f.key] ?? -1) < 0).map((f) => f.label);
}

export function applyMapping(sheet: Sheet, mapping: Mapping, fields: FieldDef[]) {
  return sheet.rows.map((r, i) => {
    const o: Record<string, string> = {};
    for (const f of fields) {
      const idx = mapping[f.key] ?? -1;
      o[f.key] = idx >= 0 ? (r[idx] ?? '') : '';
    }
    return { row: i + 2, values: o }; // +2: header is row 1
  });
}

/** Accepts yyyy-mm-dd, dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy and yyyymmdd. */
export function normaliseDate(text: string): ISODate | null {
  const t = text.trim();
  let parts: [string, string, string]; // year, month, day
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (hit) parts = [hit[1]!, hit[2]!, hit[3]!];
  else if ((hit = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t)))
    parts = [hit[3]!, hit[2]!, hit[1]!];
  else if ((hit = /^(\d{4})(\d{2})(\d{2})$/.exec(t))) parts = [hit[1]!, hit[2]!, hit[3]!];
  else return null;
  const [y, m, d] = parts;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  try {
    const out = assertISODate(iso);
    const back = new Date(`${out}T00:00:00Z`);
    return back.getUTCMonth() + 1 === Number(m) && back.getUTCDate() === Number(d) ? out : null;
  } catch {
    return null;
  }
}

export interface RowReport {
  row: number;
  status: 'ok' | 'error' | 'skipped';
  messages: string[];
}

function gstinProblem(g: string): string | null {
  const r = validateGstin(g);
  if (r.valid) return null;
  const why = {
    LENGTH: 'must be 15 characters',
    PATTERN: 'has the wrong format',
    STATE: 'has an unknown state code',
    CHECKSUM: 'failed the checksum',
  }[r.reason];
  return `GSTIN "${g}" ${why}`;
}

// ---------------------------------------------------------------- customers

export interface CustomerImportRow {
  name: string;
  gstin: string | null;
  state_code: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  credit_days: number;
}

export interface ValidatedCustomers {
  valid: { row: number; data: CustomerImportRow }[];
  report: RowReport[];
}

export function validateCustomerRows(
  rows: { row: number; values: Record<string, string> }[],
  existing: { names: Set<string>; gstins: Set<string> },
): ValidatedCustomers {
  const report: RowReport[] = [];
  const valid: ValidatedCustomers['valid'] = [];
  const seenNames = new Set<string>();
  const seenGstins = new Set<string>();
  for (const { row, values: v } of rows) {
    const errs: string[] = [];
    const name = v.name?.trim() ?? '';
    if (!name) errs.push('Name is missing');
    const gstin = (v.gstin ?? '').trim().toUpperCase();
    if (gstin) {
      const p = gstinProblem(gstin);
      if (p) errs.push(p);
    }
    let credit = 30;
    if (v.credit_days?.trim()) {
      const n = Number(v.credit_days.replace(/\D*$/, ''));
      if (!Number.isInteger(n) || n < 0 || n > 365)
        errs.push(`Credit days "${v.credit_days}" must be a whole number from 0 to 365`);
      else credit = n;
    }
    const email = v.email?.trim() ?? '';
    if (email && !/^\S+@\S+\.\S+$/.test(email)) errs.push(`Email "${email}" is not valid`);
    if (errs.length) {
      report.push({ row, status: 'error', messages: errs });
      continue;
    }
    const key = name.toLowerCase();
    if (
      existing.names.has(key) ||
      seenNames.has(key) ||
      (gstin && (existing.gstins.has(gstin) || seenGstins.has(gstin)))
    ) {
      report.push({
        row,
        status: 'skipped',
        messages: ['Customer already exists (same name or GSTIN)'],
      });
      continue;
    }
    seenNames.add(key);
    if (gstin) seenGstins.add(gstin);
    valid.push({
      row,
      data: {
        name,
        gstin: gstin || null,
        state_code: gstin ? gstin.slice(0, 2) : null,
        phone: v.phone?.trim() || null,
        email: email || null,
        address: v.address?.trim() || null,
        credit_days: credit,
      },
    });
    report.push({ row, status: 'ok', messages: [] });
  }
  return { valid, report };
}

// ----------------------------------------------------------------- invoices

export interface InvoiceImportRow {
  number: string;
  issue_date: ISODate;
  due_date: ISODate;
  fy: string;
  customerName: string;
  customerGstin: string | null;
  place_of_supply: string;
  taxable_paise: Paise;
  cgst_paise: Paise;
  sgst_paise: Paise;
  igst_paise: Paise;
  round_off_paise: Paise;
  total_paise: Paise;
}

export interface ValidatedInvoices {
  valid: { row: number; data: InvoiceImportRow }[];
  report: RowReport[];
}

export interface InvoiceImportContext {
  supplierStateCode: string;
  existingNumbers: Set<string>;
  /** lower-case customer name -> state code (or null) for customers already in the system */
  customerStates: Map<string, string | null>;
  defaultCreditDays?: number;
}

const MAX_ROUND_OFF = 100; // ₹1

function money(text: string, label: string, errs: string[]): Paise | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const p = parseRupees(t);
    if (p < 0) {
      errs.push(`${label} "${text}" cannot be negative`);
      return null;
    }
    return p;
  } catch {
    errs.push(`${label} "${text}" is not a valid amount`);
    return null;
  }
}

export function validateInvoiceRows(
  rows: { row: number; values: Record<string, string> }[],
  ctx: InvoiceImportContext,
): ValidatedInvoices {
  const report: RowReport[] = [];
  const valid: ValidatedInvoices['valid'] = [];
  const seen = new Set<string>();
  for (const { row, values: v } of rows) {
    const errs: string[] = [];
    const number = (v.number ?? '').trim();
    if (!number) errs.push('Invoice number is missing');
    else if (number.length > 16)
      errs.push(`Invoice number "${number}" is longer than 16 characters`);
    const issue = normaliseDate(v.date ?? '');
    if (!issue) errs.push(`Invoice date "${v.date ?? ''}" is not a valid date`);
    let due: ISODate | null = null;
    if ((v.dueDate ?? '').trim()) {
      due = normaliseDate(v.dueDate!);
      if (!due) errs.push(`Due date "${v.dueDate}" is not a valid date`);
      else if (issue && due < issue) errs.push('Due date is before the invoice date');
    }
    const customerName = (v.customerName ?? '').trim();
    if (!customerName) errs.push('Customer name is missing');
    const gstin = (v.customerGstin ?? '').trim().toUpperCase();
    if (gstin) {
      const p = gstinProblem(gstin);
      if (p) errs.push(p);
    }
    const total = money(v.total ?? '', 'Total', errs);
    if (total === null && !errs.some((e) => e.startsWith('Total')))
      errs.push('Total amount is missing');
    const cgst = money(v.cgst ?? '', 'CGST', errs) ?? paise(0);
    const sgst = money(v.sgst ?? '', 'SGST', errs) ?? paise(0);
    const igst = money(v.igst ?? '', 'IGST', errs) ?? paise(0);
    let taxable = money(v.taxable ?? '', 'Taxable amount', errs);
    if (taxable === null && total !== null && !errs.some((e) => e.startsWith('Taxable'))) {
      taxable = paise(Math.max(0, total - cgst - sgst - igst));
    }
    let roundOff = paise(0);
    if (total !== null && taxable !== null) {
      const diff = total - (taxable + cgst + sgst + igst);
      if (Math.abs(diff) > MAX_ROUND_OFF) {
        errs.push(
          `Total ${formatINR(total)} does not match taxable amount plus taxes (difference ${formatINR(paise(Math.abs(diff)))})`,
        );
      } else roundOff = paise(diff);
    }
    if (number && ctx.existingNumbers.has(number)) {
      if (errs.length === 0) {
        report.push({ row, status: 'skipped', messages: [`Invoice ${number} already exists`] });
        continue;
      }
    }
    if (number && seen.has(number))
      errs.push(`Invoice number "${number}" appears twice in this file`);
    if (errs.length || !issue || total === null || taxable === null) {
      report.push({ row, status: 'error', messages: errs });
      continue;
    }
    seen.add(number);
    const known = ctx.customerStates.get(customerName.toLowerCase()) ?? null;
    let pos: string;
    try {
      pos = placeOfSupply({
        supplierStateCode: ctx.supplierStateCode,
        buyerGstin: gstin || null,
        buyerStateCode: known,
      });
    } catch {
      pos = ctx.supplierStateCode;
    }
    valid.push({
      row,
      data: {
        number,
        issue_date: issue,
        due_date: due ?? addDays(issue, ctx.defaultCreditDays ?? 30),
        fy: fiscalYearOf(issue).label,
        customerName,
        customerGstin: gstin || null,
        place_of_supply: pos,
        taxable_paise: taxable,
        cgst_paise: cgst,
        sgst_paise: sgst,
        igst_paise: igst,
        round_off_paise: roundOff,
        total_paise: total,
      },
    });
    report.push({ row, status: 'ok', messages: [] });
  }
  return { valid, report };
}

export function summarise(report: RowReport[]) {
  return {
    ok: report.filter((r) => r.status === 'ok').length,
    errors: report.filter((r) => r.status === 'error').length,
    skipped: report.filter((r) => r.status === 'skipped').length,
  };
}
