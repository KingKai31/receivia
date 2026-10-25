import { calcInvoice, GST_RATES, isStateCode, type StateCode } from '@/lib/gst';
import { validateGstin } from '@/lib/gstin';
import { formatINR, paise } from '@/lib/money';

/** What the model reads off a printed invoice. Amounts are rupees as printed; nothing here is trusted. */
export interface ScannedLine {
  description: string;
  hsn: string;
  qty: number;
  rate: number;
  discount: number;
  gst_rate: number;
}
export interface ScannedInvoice {
  invoice_no: string | null;
  date: string | null;
  seller_gstin: string | null;
  buyer_gstin: string | null;
  place_of_supply: string | null;
  lines: ScannedLine[];
  printed: {
    taxable: number | null;
    cgst: number | null;
    sgst: number | null;
    igst: number | null;
    total: number | null;
  };
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e10 ? v : null;
const str = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** Shapes the raw tool input into ScannedInvoice. Bad values become null; lines are capped at 100. */
export function normalizeScan(raw: unknown): ScannedInvoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const linesIn = Array.isArray(r.lines) ? r.lines.slice(0, 100) : [];
  const lines: ScannedLine[] = [];
  for (const l of linesIn) {
    if (!l || typeof l !== 'object') continue;
    const x = l as Record<string, unknown>;
    const rate = num(x.rate);
    const qty = num(x.qty);
    if (rate === null || qty === null) continue;
    lines.push({
      description: str(x.description) ?? 'Item',
      hsn: (str(x.hsn, 8) ?? '').replace(/\D/g, ''),
      qty,
      rate,
      discount: num(x.discount) ?? 0,
      gst_rate: typeof x.gst_rate === 'number' ? x.gst_rate : 0,
    });
  }
  const p = (r.printed && typeof r.printed === 'object' ? r.printed : {}) as Record<
    string,
    unknown
  >;
  const date = str(r.date, 10);
  return {
    invoice_no: str(r.invoice_no, 40),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    seller_gstin: str(r.seller_gstin, 15)?.toUpperCase() ?? null,
    buyer_gstin: str(r.buyer_gstin, 15)?.toUpperCase() ?? null,
    place_of_supply: str(r.place_of_supply, 2),
    lines,
    printed: {
      taxable: num(p.taxable),
      cgst: num(p.cgst),
      sgst: num(p.sgst),
      igst: num(p.igst),
      total: num(p.total),
    },
  };
}

export interface Finding {
  kind: 'gstin' | 'rate' | 'tax_type' | 'amount' | 'info';
  level: 'error' | 'warn' | 'ok';
  message: string;
  /** Printed minus correct, in paise (positive = printed too high). */
  diffPaise?: number;
}

export interface AuditResult {
  findings: Finding[];
  correct: { taxable: number; cgst: number; sgst: number; igst: number; total: number } | null;
  intraState: boolean | null;
  mismatches: number;
}

/** Tolerance for rounding differences between how a printed invoice and this app round (paise). */
const TOL = 2;

/** Deterministic audit: GSTIN check digits, recomputed GST (src/lib/gst), printed against correct. */
export function auditScan(scan: ScannedInvoice): AuditResult {
  const findings: Finding[] = [];
  const gs = (label: string, g: string | null): StateCode | null => {
    if (!g) {
      findings.push({
        kind: 'gstin',
        level: 'warn',
        message: `${label} GSTIN not read from the image.`,
      });
      return null;
    }
    const v = validateGstin(g);
    if (v.valid) {
      findings.push({
        kind: 'gstin',
        level: 'ok',
        message: `${label} GSTIN ${g} passes the check digit.`,
      });
      return v.stateCode;
    }
    const why =
      v.reason === 'CHECKSUM'
        ? 'its check digit does not match'
        : v.reason === 'STATE'
          ? 'its state code is unknown'
          : v.reason === 'LENGTH'
            ? 'it is not 15 characters'
            : 'its format is wrong';
    findings.push({
      kind: 'gstin',
      level: 'error',
      message: `${label} GSTIN ${g} is not valid: ${why}.`,
    });
    return null;
  };
  const sellerState = gs('Seller', scan.seller_gstin);
  const buyerState = gs('Buyer', scan.buyer_gstin);
  const posRaw = scan.place_of_supply;
  const pos = posRaw && isStateCode(posRaw) ? posRaw : (buyerState ?? null);

  let correct: AuditResult['correct'] = null;
  let intra: boolean | null = null;
  if (!sellerState || !pos) {
    findings.push({
      kind: 'info',
      level: 'warn',
      message: 'Could not work out seller state and place of supply, so GST was not recomputed.',
    });
  } else if (scan.lines.length === 0) {
    findings.push({
      kind: 'info',
      level: 'warn',
      message: 'No line items were read, so GST was not recomputed.',
    });
  } else {
    for (const l of scan.lines) {
      if (!(GST_RATES as readonly number[]).includes(l.gst_rate)) {
        findings.push({
          kind: 'rate',
          level: 'error',
          message: `"${l.description}": GST rate ${l.gst_rate}% is not a valid slab (0, 0.25, 3, 5, 18, 40).`,
        });
      }
    }
    const usable = scan.lines.filter((l) => (GST_RATES as readonly number[]).includes(l.gst_rate));
    try {
      const calc = calcInvoice({
        lines: usable.map((l) => ({
          qty: l.qty,
          rate: paise(Math.round(l.rate * 100)),
          discount: paise(Math.min(Math.round(l.discount * 100), Math.round(l.qty * l.rate * 100))),
          gstRate: l.gst_rate,
        })),
        supplierStateCode: sellerState,
        placeOfSupply: pos,
        registrationType: 'regular',
      });
      intra = calc.intraState;
      correct = {
        taxable: calc.taxable,
        cgst: calc.cgst,
        sgst: calc.sgst,
        igst: calc.igst,
        total: calc.grandTotal,
      };
      const pr = scan.printed;
      const cmp = (label: string, printed: number | null, right: number) => {
        if (printed === null) return;
        const diff = Math.round(printed * 100) - right;
        if (Math.abs(diff) > TOL) {
          findings.push({
            kind: 'amount',
            level: 'error',
            diffPaise: diff,
            message: `${label}: printed ${formatINR(paise(Math.round(printed * 100)))}, should be ${formatINR(paise(right))} (${diff > 0 ? 'over' : 'under'} by ${formatINR(paise(Math.abs(diff)))}).`,
          });
        }
      };
      if (intra && (pr.igst ?? 0) > 0 && (pr.cgst ?? 0) === 0 && (pr.sgst ?? 0) === 0) {
        findings.push({
          kind: 'tax_type',
          level: 'error',
          message:
            'Seller and place of supply are in the same state, so CGST + SGST apply, but IGST was charged.',
        });
      } else if (!intra && ((pr.cgst ?? 0) > 0 || (pr.sgst ?? 0) > 0) && (pr.igst ?? 0) === 0) {
        findings.push({
          kind: 'tax_type',
          level: 'error',
          message: 'Supply is to another state, so IGST applies, but CGST + SGST were charged.',
        });
      }
      cmp('Taxable value', pr.taxable, calc.taxable);
      cmp('CGST', pr.cgst, calc.cgst);
      cmp('SGST', pr.sgst, calc.sgst);
      cmp('IGST', pr.igst, calc.igst);
      cmp('Invoice total', pr.total, calc.grandTotal);
    } catch {
      findings.push({
        kind: 'info',
        level: 'warn',
        message: 'The line values could not be recomputed.',
      });
    }
  }
  const mismatches = findings.filter((f) => f.level === 'error').length;
  if (mismatches === 0 && correct) {
    findings.push({
      kind: 'info',
      level: 'ok',
      message: 'Printed amounts match the recomputed GST.',
    });
  }
  return { findings, correct, intraState: intra, mismatches };
}
