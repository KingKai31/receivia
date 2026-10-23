import { describe, expect, it } from 'vitest';
import { paise } from '@/lib/money';
import {
  GENERAL_INFO_HI,
  GENERAL_INFO_LINE,
  GENERAL_INFO_MR,
  buyerLens,
  itc180,
  msmeDueDate,
  msmeEligibility,
  msmeForm1,
  msmedInterest,
  sec43bh,
  type BuyerFacts,
  type InvoiceFacts,
  type SellerFacts,
} from './index';

const seller: SellerFacts = { udyam_number: 'UDYAM-MH-01-0000001', enterprise_size: 'small', activity: 'manufacturing' };
const buyer: BuyerFacts = { gstin: '27AAPFU0939F1ZV', entity_type: 'firm', presumptive_tax: 'no', credit_days: 30, has_written_agreement: true };
const inv: InvoiceFacts = {
  invoice_type: 'tax_invoice', issue_date: '2026-04-01', total_paise: 118000, paid_paise: 0,
  cgst_paise: 9000, sgst_paise: 9000, igst_paise: 0, reverse_charge: false,
};

function endsOk(r: { sentence_en: string; sentence_hi: string; sentence_mr: string }) {
  expect(r.sentence_en.endsWith(GENERAL_INFO_LINE)).toBe(true);
  expect(r.sentence_hi.endsWith(GENERAL_INFO_HI)).toBe(true);
  expect(r.sentence_mr.endsWith(GENERAL_INFO_MR)).toBe(true);
}

describe('itc180', () => {
  it('applies with date and unpaid GST (proportional to unpaid part)', () => {
    const r = itc180({ ...inv, paid_paise: 59000 }, buyer, '2026-05-01');
    expect(r.applies).toBe(true);
    expect(r.facts.date_180).toBe('2026-09-28');
    expect(r.facts.unpaid_gst_paise).toBe(9000);
    expect(r.sentence_en).toContain('Section 16(2)');
    expect(r.sentence_en).toContain('Rule 37');
    endsOk(r);
  });
  it('past-date wording', () => {
    expect(itc180(inv, buyer, '2026-12-01').sentence_en).toContain('that was 2026-09-28');
  });
  it.each([
    ['no GSTIN', inv, { ...buyer, gstin: null }],
    ['bill of supply', { ...inv, invoice_type: 'bill_of_supply' as const }, buyer],
    ['reverse charge', { ...inv, reverse_charge: true }, buyer],
    ['fully paid', { ...inv, paid_paise: 118000 }, buyer],
  ])('does not apply: %s', (_n, i, b) => {
    const r = itc180(i, b, '2026-05-01');
    expect(r.applies).toBe(false);
    expect(r.sentence_en).toBe('');
  });
});

describe('msme', () => {
  it('eligibility needs Udyam, micro/small, manufacturing/services', () => {
    expect(msmeEligibility(seller).applies).toBe(true);
    expect(msmeEligibility({ ...seller, activity: 'services', enterprise_size: 'micro' }).applies).toBe(true);
    expect(msmeEligibility({ ...seller, activity: 'trading' }).applies).toBe(false);
    expect(msmeEligibility({ ...seller, enterprise_size: 'medium' }).applies).toBe(false);
    expect(msmeEligibility({ ...seller, udyam_number: null }).applies).toBe(false);
    expect(msmeEligibility({ ...seller, udyam_number: '  ' }).applies).toBe(false);
  });
  it('due date caps agreed days at 45 with agreement, else 15', () => {
    expect(msmeDueDate('2026-04-01', 30, true)).toBe('2026-05-01');
    expect(msmeDueDate('2026-04-01', 90, true)).toBe('2026-05-16');
    expect(msmeDueDate('2026-04-01', 30, false)).toBe('2026-04-16');
    expect(msmeDueDate('2026-04-01', 90, false)).toBe('2026-04-16');
  });
  it('43B(h): firm, soft, and not-applicable cases', () => {
    const due = '2026-05-16';
    const firm = sec43bh({ seller, buyer, msmeDue: due, today: '2026-06-01' });
    expect(firm.applies).toBe(true);
    expect(firm.facts.certainty).toBe('firm');
    expect(firm.sentence_en).toContain('43B(h)');
    endsOk(firm);
    const soft = sec43bh({ seller, buyer: { ...buyer, presumptive_tax: 'unknown' }, msmeDue: due, today: '2026-06-01' });
    expect(soft.facts.certainty).toBe('soft');
    expect(soft.sentence_en).toContain('If your business is not taxed on a presumptive basis');
    for (const b of [{ ...buyer, presumptive_tax: 'yes' as const }, { ...buyer, entity_type: 'individual' as const }, { ...buyer, entity_type: 'government' as const }]) {
      expect(sec43bh({ seller, buyer: b, msmeDue: due, today: '2026-06-01' }).applies).toBe(false);
    }
    expect(sec43bh({ seller: { ...seller, activity: 'trading' }, buyer, msmeDue: due, today: '2026-06-01' }).applies).toBe(false);
  });
  it('Form 1 only for companies past due', () => {
    const co = { ...buyer, entity_type: 'company' as const };
    expect(msmeForm1({ buyer: co, msmeDue: '2026-05-16', today: '2026-06-01' }).applies).toBe(true);
    endsOk(msmeForm1({ buyer: co, msmeDue: '2026-05-16', today: '2026-06-01' }));
    expect(msmeForm1({ buyer: co, msmeDue: '2026-05-16', today: '2026-05-10' }).applies).toBe(false);
    expect(msmeForm1({ buyer, msmeDue: '2026-05-16', today: '2026-06-01' }).applies).toBe(false);
  });
  it('interest: zero before due, compounding monthly beats simple', () => {
    expect(msmedInterest({ principal: paise(100000), dueDate: '2026-05-01', asOf: '2026-05-01', bankRatePct: 6 }).interest_paise).toBe(0);
    const one = msmedInterest({ principal: paise(10_000_000), dueDate: '2026-01-01', asOf: '2026-02-01', bankRatePct: 6 });
    expect(one.months).toBe(1);
    expect(one.interest_paise).toBe(Math.round((10_000_000 * 18 * 31) / 36500));
    const year = msmedInterest({ principal: paise(10_000_000), dueDate: '2026-01-01', asOf: '2027-01-01', bankRatePct: 6 });
    expect(year.months).toBe(12);
    const simple = Math.round((10_000_000 * 18 * 365) / 36500);
    expect(year.interest_paise).toBeGreaterThan(simple);
  });
});

describe('buyer lens coverage', () => {
  const base = { seller, invoice: inv, today: '2026-06-01' };
  it('MSME-eligible seller, regular buyer: 43B(h)', () => {
    const l = buyerLens({ ...base, buyer });
    expect(l.source).toBe('sec43bh');
    expect(l.line_en.endsWith(GENERAL_INFO_LINE)).toBe(true);
  });
  it('trader seller: falls back to ITC 180', () => {
    const l = buyerLens({ ...base, seller: { ...seller, activity: 'trading' }, buyer });
    expect(l.source).toBe('itc180');
  });
  it('presumptive yes: ITC line; unknown: soft 43B(h)', () => {
    expect(buyerLens({ ...base, buyer: { ...buyer, presumptive_tax: 'yes' } }).source).toBe('itc180');
    const u = buyerLens({ ...base, buyer: { ...buyer, presumptive_tax: 'unknown' } });
    expect(u.source).toBe('sec43bh');
    expect(u.line_en).toContain('If your business is not taxed on a presumptive basis');
  });
  it('government buyer: no 43B(h); ITC only with GSTIN', () => {
    expect(buyerLens({ ...base, buyer: { ...buyer, entity_type: 'government' } }).source).toBe('itc180');
    expect(buyerLens({ ...base, buyer: { ...buyer, entity_type: 'government', gstin: null } }).source).toBeNull();
  });
  it('unregistered buyer: 43B(h) still, no ITC; trader + unregistered: nothing', () => {
    expect(buyerLens({ ...base, buyer: { ...buyer, gstin: null } }).source).toBe('sec43bh');
    const none = buyerLens({ ...base, seller: { ...seller, activity: 'trading' }, buyer: { ...buyer, gstin: null } });
    expect(none.source).toBeNull();
    expect(none.line_en).toBe('');
  });
});
