import {
  calcInvoice,
  placeOfSupply,
  type InvoiceResult,
  type LineInput,
  type RegistrationType,
} from '@/lib/gst';
import { addDays, fiscalYearOf, todayIST, type ISODate } from '@/lib/dates';
import { paise, parseRupees, type Paise } from '@/lib/money';
import { ServiceError } from '@/lib/service/errors';

/** What the user types on the invoice form; money and quantity stay as text until computed. */
export interface DraftLine {
  description: string;
  hsn_sac: string;
  qty: string;
  unit: string;
  rate: string;
  discount: string;
  gst_rate: number;
}

export interface DraftInput {
  customerId: string;
  issueDate: ISODate;
  creditDays: number;
  /** Optional manual override of the due date. */
  dueDate?: ISODate;
  reverseCharge: boolean;
  deliveryAddress: string;
  notes: string;
  lines: DraftLine[];
}

export interface SupplierInfo {
  stateCode: string;
  registrationType: RegistrationType;
}

export interface BuyerInfo {
  gstin: string | null;
  state_code: string | null;
}

export const EMPTY_LINE: DraftLine = {
  description: '',
  hsn_sac: '',
  qty: '1',
  unit: 'Nos',
  rate: '',
  discount: '',
  gst_rate: 18,
};

/** Quantity text to a number with at most 3 decimals. */
export function parseQty(text: string): number {
  const t = text.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) {
    throw new ServiceError('VALIDATION', `Quantity "${text}" is not valid (up to 3 decimals).`);
  }
  return Number(t);
}

export function dueDateFor(issueDate: ISODate, creditDays: number): ISODate {
  return addDays(issueDate, creditDays);
}

export interface ComputedDraft {
  placeOfSupply: string;
  fy: string;
  dueDate: ISODate;
  lineInputs: LineInput[];
  calc: InvoiceResult;
}

/** Turns the form into amounts using src/lib/gst. Throws ServiceError(VALIDATION) on bad input. */
export function computeDraft(
  input: DraftInput,
  supplier: SupplierInfo,
  buyer: BuyerInfo,
): ComputedDraft {
  if (input.lines.length === 0) throw new ServiceError('VALIDATION', 'Add at least one line.');
  const lineInputs: LineInput[] = input.lines.map((l, i) => {
    if (!l.description.trim()) {
      throw new ServiceError('VALIDATION', `Line ${i + 1}: description is required.`);
    }
    try {
      return {
        qty: parseQty(l.qty),
        rate: l.rate.trim() ? parseRupees(l.rate) : paise(0),
        discount: l.discount.trim() ? parseRupees(l.discount) : paise(0),
        gstRate: l.gst_rate,
      };
    } catch (e) {
      throw new ServiceError('VALIDATION', `Line ${i + 1}: ${(e as Error).message}`);
    }
  });
  const pos = placeOfSupply({
    supplierStateCode: supplier.stateCode,
    buyerGstin: buyer.gstin,
    buyerStateCode: buyer.state_code,
  });
  let calc: InvoiceResult;
  try {
    calc = calcInvoice({
      lines: lineInputs,
      supplierStateCode: supplier.stateCode,
      placeOfSupply: pos,
      registrationType: supplier.registrationType,
    });
  } catch (e) {
    throw new ServiceError('VALIDATION', (e as Error).message);
  }
  return {
    placeOfSupply: pos,
    fy: fiscalYearOf(input.issueDate).label,
    dueDate: input.dueDate ?? dueDateFor(input.issueDate, input.creditDays),
    lineInputs,
    calc,
  };
}

export function headerPayload(input: DraftInput, c: ComputedDraft, supplierState: string) {
  return {
    customer_id: input.customerId,
    fy: c.fy,
    invoice_type: c.calc.invoiceType,
    issue_date: input.issueDate,
    due_date: c.dueDate,
    supplier_state_code: supplierState,
    place_of_supply: c.placeOfSupply,
    taxable_paise: c.calc.taxable,
    cgst_paise: c.calc.cgst,
    sgst_paise: c.calc.sgst,
    igst_paise: c.calc.igst,
    round_off_paise: c.calc.roundOff,
    total_paise: c.calc.grandTotal,
    notes: input.notes.trim() || null,
    reverse_charge: input.reverseCharge,
    delivery_address: input.deliveryAddress.trim() || null,
  };
}

export function linesPayload(input: DraftInput, c: ComputedDraft) {
  return input.lines.map((l, i) => {
    const r = c.calc.lines[i]!;
    const li = c.lineInputs[i]!;
    return {
      description: l.description.trim(),
      hsn_sac: l.hsn_sac.trim() || null,
      qty: li.qty,
      unit: l.unit.trim() || null,
      rate_paise: li.rate,
      discount_paise: li.discount ?? 0,
      gst_rate: li.gstRate,
      taxable_paise: r.taxable,
      cgst_paise: r.cgst,
      sgst_paise: r.sgst,
      igst_paise: r.igst,
      total_paise: r.total,
    };
  });
}

export type DisplayStatus =
  'draft' | 'issued' | 'due soon' | 'overdue' | 'part paid' | 'paid' | 'disputed' | 'void';

export const DUE_SOON_DAYS = 7;

export interface StatusInput {
  status: string;
  due_date: string;
  disputed: boolean;
}

/**
 * The word shown for an invoice. Precedence: void, draft, paid, disputed, overdue, part paid,
 * due soon, issued. Overdue wins over part paid so unpaid balances past due are never hidden.
 */
export function displayStatus(inv: StatusInput, today: ISODate = todayIST()): DisplayStatus {
  if (inv.status === 'void') return 'void';
  if (inv.status === 'draft') return 'draft';
  if (inv.status === 'paid') return 'paid';
  if (inv.disputed) return 'disputed';
  if (inv.due_date < today) return 'overdue';
  if (inv.status === 'partially_paid') return 'part paid';
  if (inv.due_date <= addDays(today, DUE_SOON_DAYS)) return 'due soon';
  return 'issued';
}

export function totalPaise(n: number): Paise {
  return paise(n);
}
