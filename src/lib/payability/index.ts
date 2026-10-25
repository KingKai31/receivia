import { PAYABILITY_CONFIG as C } from './config';

export { PAYABILITY_CONFIG } from './config';

export type CheckKey = keyof typeof C.weights;

export interface PayabilityInput {
  buyer: {
    gstin: string | null;
    gstinValid: boolean;
    stateCode: string | null;
    poRequired: boolean;
    apName: string | null;
    apEmail: string | null;
    apPhone: string | null;
  };
  placeOfSupply: string;
  poNumber: string | null;
  /** True when the supply is goods (any line without a service SAC starting 99). */
  hasGoods: boolean;
  interState: boolean;
  goodsValuePaise: number;
  delivery: { ewayBillNo: string | null; reference: string | null; proofUploaded: boolean };
  hsnCodes: (string | null)[];
  turnoverPaise: number;
  dueDate: string | null;
  issueDate: string | null;
  creditDays: number | null;
  bank: { account: boolean; upi: boolean };
}

export interface CheckResult {
  key: CheckKey;
  label: string;
  points: number;
  max: number;
  ok: boolean;
  reason: string;
}

export interface Payability {
  score: number;
  checks: CheckResult[];
  reasons: string[];
}

const filled = (s: string | null | undefined) => !!s && s.trim().length > 0;

export function requiredHsnDigits(turnoverPaise: number): number {
  return C.hsnTiers.find((t) => turnoverPaise <= t.upToPaise)!.digits;
}

export function scorePayability(i: PayabilityInput): Payability {
  const w = C.weights;
  const checks: CheckResult[] = [];
  const add = (key: CheckKey, label: string, points: number, reason: string) =>
    checks.push({ key, label, points, max: w[key], ok: points === w[key], reason });

  // Buyer GSTIN valid and its state matches the place of supply.
  if (!filled(i.buyer.gstin)) {
    add('gstin', 'Buyer GSTIN', 0, 'No buyer GSTIN on file.');
  } else if (!i.buyer.gstinValid) {
    add('gstin', 'Buyer GSTIN', 0, 'Buyer GSTIN is not valid.');
  } else if (i.buyer.gstin!.slice(0, 2) !== i.placeOfSupply) {
    add(
      'gstin',
      'Buyer GSTIN',
      Math.round(w.gstin / 2),
      'Buyer GSTIN state differs from the place of supply.',
    );
  } else {
    add('gstin', 'Buyer GSTIN', w.gstin, 'GSTIN valid and matches the place of supply.');
  }

  // PO or reference number.
  if (filled(i.poNumber))
    add('po', 'PO or reference number', w.po, 'PO or reference number present.');
  else if (i.buyer.poRequired)
    add('po', 'PO or reference number', 0, 'This buyer requires a PO number.');
  else add('po', 'PO or reference number', Math.round(w.po / 2), 'No PO or reference number.');

  // Buyer AP contact: name plus email or phone.
  const hasName = filled(i.buyer.apName);
  const hasChannel = filled(i.buyer.apEmail) || filled(i.buyer.apPhone);
  if (hasName && hasChannel)
    add(
      'apContact',
      'Accounts payable contact',
      w.apContact,
      'AP contact has a name and a way to reach them.',
    );
  else if (hasName || hasChannel)
    add(
      'apContact',
      'Accounts payable contact',
      Math.round(w.apContact / 2),
      'AP contact needs both a name and an email or phone.',
    );
  else add('apContact', 'Accounts payable contact', 0, 'No accounts payable contact.');

  // Delivery reference.
  const ewayNeeded = i.hasGoods && i.interState && i.goodsValuePaise > C.ewayBillThresholdPaise;
  if (ewayNeeded) {
    if (filled(i.delivery.ewayBillNo))
      add('delivery', 'Delivery reference', w.delivery, 'E-way bill number present.');
    else
      add(
        'delivery',
        'Delivery reference',
        0,
        'Inter-state goods above ₹50,000 generally need an e-way bill number (verify on cbic-gst.gov.in).',
      );
  } else if (!i.hasGoods) {
    add('delivery', 'Delivery reference', w.delivery, 'Services: no delivery reference needed.');
  } else if (
    filled(i.delivery.ewayBillNo) ||
    filled(i.delivery.reference) ||
    i.delivery.proofUploaded
  ) {
    add(
      'delivery',
      'Delivery reference',
      w.delivery,
      'GRN, challan, e-way bill or delivery proof present.',
    );
  } else {
    add('delivery', 'Delivery reference', 0, 'No GRN, challan or delivery proof yet.');
  }

  // HSN digits.
  const need = requiredHsnDigits(i.turnoverPaise);
  const bad = i.hsnCodes.filter(
    (h) => (h ?? '').replace(/\D/g, '').length < need || !/^\d*$/.test((h ?? '').trim()),
  );
  if (need === 0) add('hsn', 'HSN or SAC digits', w.hsn, 'HSN not required at this turnover.');
  else if (bad.length === 0)
    add('hsn', 'HSN or SAC digits', w.hsn, `All lines have ${need}+ digit HSN or SAC.`);
  else add('hsn', 'HSN or SAC digits', 0, `${bad.length} line(s) need at least ${need} digits.`);

  // Due date and credit terms.
  if (
    filled(i.dueDate) &&
    i.creditDays !== null &&
    i.creditDays !== undefined &&
    (!filled(i.issueDate) || i.dueDate! >= i.issueDate!)
  ) {
    add('terms', 'Due date and credit terms', w.terms, 'Due date and credit terms set.');
  } else {
    add(
      'terms',
      'Due date and credit terms',
      0,
      'Set the credit terms and a due date on or after the invoice date.',
    );
  }

  // Bank or UPI.
  if (i.bank.account || i.bank.upi)
    add('bank', 'Bank or UPI', w.bank, 'Bank account or UPI id on the invoice.');
  else add('bank', 'Bank or UPI', 0, 'Add a bank account or UPI id in Settings.');

  const score = checks.reduce((s, c) => s + c.points, 0);
  return { score, checks, reasons: checks.filter((c) => !c.ok).map((c) => c.reason) };
}

export type IssueGate =
  | { allowed: true; override: false }
  | { allowed: false; needsOverride: true; score: number; threshold: number };

/** Below the threshold issuing needs an owner override. */
export function issueGate(score: number, threshold: number = C.defaultThreshold): IssueGate {
  return score >= threshold
    ? { allowed: true, override: false }
    : { allowed: false, needsOverride: true, score, threshold };
}

export const READY_SCORE = 85;
export const isReadyToGetPaid = (score: number | null | undefined) => (score ?? 0) >= READY_SCORE;
