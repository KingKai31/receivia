import { paise, type Paise } from '@/lib/money';

/**
 * TDS / TCS rates used to explain a short payment. Rates change; verify on incometax.gov.in and
 * cbic-gst.gov.in before relying on them. Shortfall is matched as rate x taxable value, +/- Rs 1.
 */
export type TdsSection = '194C' | '194J' | '194H' | '194Q' | 'GST_TDS' | 'GST_TCS';
export type EntityKind = 'company' | 'firm' | 'proprietor' | 'government' | 'individual' | null;

export interface TdsRule {
  section: TdsSection;
  ratePct: number;
  label: string;
  /** Buyer types this rate is for; undefined = any. */
  buyers?: EntityKind[];
}

export const TDS_RULES: readonly TdsRule[] = [
  {
    section: 'GST_TDS',
    ratePct: 2,
    label: 'GST TDS 2% (government buyers, on taxable value)',
    buyers: ['government'],
  },
  {
    section: '194C',
    ratePct: 2,
    label: '194C 2% (contractor: company or firm)',
    buyers: ['company', 'firm', 'government', null],
  },
  {
    section: '194C',
    ratePct: 1,
    label: '194C 1% (contractor: individual or HUF)',
    buyers: ['proprietor', 'individual'],
  },
  { section: '194J', ratePct: 10, label: '194J 10% (professional fees)' },
  { section: '194J', ratePct: 2, label: '194J 2% (technical services, call centre)' },
  { section: '194H', ratePct: 2, label: '194H 2% (commission or brokerage)' },
  {
    section: '194Q',
    ratePct: 0.1,
    label: '194Q 0.1% (purchase of goods)',
    buyers: ['company', 'firm', 'government', null],
  },
  { section: 'GST_TCS', ratePct: 0.5, label: 'GST TCS 0.5% (e-commerce operator)' },
];

export const TDS_TOLERANCE_PAISE = 100;

export interface TdsCandidate {
  section: TdsSection;
  ratePct: number;
  amountPaise: Paise;
  taxablePaise: Paise;
  label: string;
  alsoPossible: string[];
}

/** Half-up rate x taxable in paise, rounded in integers (rate has at most 2 decimals). */
export function tdsAmount(taxablePaise: number, ratePct: number): Paise {
  const hundredths = Math.round(ratePct * 100);
  return paise(Math.floor((taxablePaise * hundredths + 5000) / 10000));
}

/** Rules that explain this shortfall for this buyer type, most likely first. */
export function explainShortfall(args: {
  shortfallPaise: number;
  taxablePaise: number;
  entity: EntityKind;
}): TdsCandidate | null {
  const { shortfallPaise, taxablePaise, entity } = args;
  if (shortfallPaise <= 0 || taxablePaise <= 0) return null;
  const hits = TDS_RULES.filter((r) => {
    if (r.buyers && !r.buyers.includes(entity)) return false;
    return Math.abs(tdsAmount(taxablePaise, r.ratePct) - shortfallPaise) <= TDS_TOLERANCE_PAISE;
  });
  const best = hits[0];
  if (!best) return null;
  return {
    section: best.section,
    ratePct: best.ratePct,
    amountPaise: paise(shortfallPaise),
    taxablePaise: paise(taxablePaise),
    label: best.label,
    alsoPossible: hits.slice(1).map((h) => h.label),
  };
}

/** Indian FY quarter label for a date, e.g. "26-27 Q2" (Q1 = Apr-Jun). */
export function tdsQuarter(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  const q = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 ? 3 : 4;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)} Q${q}`;
}
