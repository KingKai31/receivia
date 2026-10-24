import { paise, roundToPaise, type Paise } from '@/lib/money';
import {
  COMPOSITION_HEADING,
  E_INVOICE_NOTE,
  E_INVOICE_THRESHOLD_PAISE,
  GST_RATES,
} from './config';
import { GstError, assertStateCode, type StateCode } from './states';

export type RegistrationType = 'regular' | 'composition' | 'unregistered';
export type InvoiceType = 'tax_invoice' | 'bill_of_supply' | 'invoice';

export interface LineInput {
  /** Quantity, up to 3 decimals. */
  qty: number;
  /** Unit price before tax. */
  rate: Paise;
  /** Absolute discount on the line. */
  discount?: Paise;
  /** GST rate in percent, from GST_RATES. */
  gstRate: number;
}

export interface LineResult {
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  total: Paise;
}

export interface InvoiceInput {
  lines: LineInput[];
  supplierStateCode: string;
  placeOfSupply: string;
  registrationType: RegistrationType;
}

export interface InvoiceResult {
  invoiceType: InvoiceType;
  intraState: boolean;
  lines: LineResult[];
  taxable: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  totalTax: Paise;
  /** Sum before round-off. */
  subtotal: Paise;
  /** Positive or negative adjustment to reach a whole rupee. */
  roundOff: Paise;
  grandTotal: Paise;
}

/** Percentage discount helper: pct may have up to 2 decimals. */
export function percentDiscount(gross: Paise, pct: number): Paise {
  return roundToPaise((gross * Math.round(pct * 100)) / 10000);
}

/** Round non-negative integer a*b/d half up, using integer arithmetic. */
function mulDivRound(a: number, b: number, d: number): Paise {
  const num = a * b;
  if (!Number.isSafeInteger(num)) throw new GstError('INVALID_LINE', 'Amount too large');
  return paise(Math.floor((num + d / 2) / d));
}

export function placeOfSupply(args: {
  supplierStateCode: string;
  buyerGstin?: string | null;
  buyerStateCode?: string | null;
}): StateCode {
  if (args.buyerGstin) return assertStateCode(args.buyerGstin.slice(0, 2));
  if (args.buyerStateCode) return assertStateCode(args.buyerStateCode);
  return assertStateCode(args.supplierStateCode);
}

export function invoiceTypeFor(reg: RegistrationType): InvoiceType {
  return reg === 'regular' ? 'tax_invoice' : reg === 'composition' ? 'bill_of_supply' : 'invoice';
}

export function invoiceHeading(reg: RegistrationType): string {
  const type = invoiceTypeFor(reg);
  return type === 'tax_invoice'
    ? 'Tax Invoice'
    : type === 'bill_of_supply'
      ? 'Bill of Supply'
      : 'Invoice';
}

/** Extra line printed under the heading, if any. */
export function invoiceSubheading(reg: RegistrationType): string | null {
  return reg === 'composition' ? COMPOSITION_HEADING : null;
}

export function eInvoiceNote(turnover: Paise): string | null {
  return turnover > E_INVOICE_THRESHOLD_PAISE ? E_INVOICE_NOTE : null;
}

export function calcLine(line: LineInput, intraState: boolean, collectsTax = true): LineResult {
  if (!(GST_RATES as readonly number[]).includes(line.gstRate)) {
    throw new GstError('INVALID_RATE', `GST rate ${line.gstRate}% is not in the rate table`);
  }
  if (!(line.qty >= 0) || !Number.isFinite(line.qty)) {
    throw new GstError('INVALID_LINE', 'Quantity must be zero or more');
  }
  const gross = mulDivRound(Math.round(line.qty * 1000), line.rate, 1000);
  const discount = line.discount ?? paise(0);
  if (discount < 0 || discount > gross) {
    throw new GstError('INVALID_LINE', 'Discount must be between 0 and the line amount');
  }
  const taxable = paise(gross - discount);
  const bp = Math.round(line.gstRate * 100); // basis points of percent
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (collectsTax && bp > 0) {
    if (intraState) {
      // each half: taxable * (bp/2) / 10000, rounded separately
      cgst = mulDivRound(taxable, bp, 20000);
      sgst = mulDivRound(taxable, bp, 20000);
    } else {
      igst = mulDivRound(taxable, bp, 10000);
    }
  }
  return {
    taxable,
    cgst: paise(cgst),
    sgst: paise(sgst),
    igst: paise(igst),
    total: paise(taxable + cgst + sgst + igst),
  };
}

export function calcInvoice(input: InvoiceInput): InvoiceResult {
  const supplier = assertStateCode(input.supplierStateCode);
  const pos = assertStateCode(input.placeOfSupply);
  const intraState = supplier === pos;
  const collectsTax = input.registrationType === 'regular';
  const lines = input.lines.map((l) => calcLine(l, intraState, collectsTax));
  const sum = (pick: (l: LineResult) => number) => paise(lines.reduce((s, l) => s + pick(l), 0));
  const taxable = sum((l) => l.taxable);
  const cgst = sum((l) => l.cgst);
  const sgst = sum((l) => l.sgst);
  const igst = sum((l) => l.igst);
  const subtotal = paise(taxable + cgst + sgst + igst);
  const roundOff = paise(Math.floor((subtotal + 50) / 100) * 100 - subtotal);
  return {
    invoiceType: invoiceTypeFor(input.registrationType),
    intraState,
    lines,
    taxable,
    cgst,
    sgst,
    igst,
    totalTax: paise(cgst + sgst + igst),
    subtotal,
    roundOff,
    grandTotal: paise(subtotal + roundOff),
  };
}
