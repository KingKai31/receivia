import { describe, expect, it } from 'vitest';
import { acceptanceOf } from '@/lib/legal/acceptance';
import { msmeDueDate } from '@/lib/legal';
import { INSTALMENT_CONFIG, splitEvenly, validatePlan } from '@/lib/instalments';
import { checkCredit } from '@/lib/credit';
import { buyerLens } from '@/lib/legal';

describe('acceptance drives MSMED dates', () => {
  const base = { issue_date: '2026-09-01' as const };
  it('assumed from the invoice date when nothing is recorded', () => {
    const a = acceptanceOf(base);
    expect(a).toMatchObject({ date: '2026-09-01', assumed: true });
    expect(a.label).toMatch(/invoice date/);
  });
  it('a typed delivery date is still assumed', () => {
    expect(acceptanceOf({ ...base, accepted_on: '2026-09-05', acceptance_source: 'assumed_delivery_date' })).toMatchObject({ date: '2026-09-05', assumed: true });
  });
  it('buyer confirmation and proof are firm', () => {
    expect(acceptanceOf({ ...base, accepted_on: '2026-09-10', acceptance_source: 'buyer_confirmed' }).assumed).toBe(false);
    expect(acceptanceOf({ ...base, accepted_on: '2026-09-10', acceptance_source: 'proof_uploaded' }).assumed).toBe(false);
  });
  it('the due date moves with the acceptance date', () => {
    const early = msmeDueDate(acceptanceOf(base).date, 45, true);
    const late = msmeDueDate(acceptanceOf({ ...base, accepted_on: '2026-09-11', acceptance_source: 'buyer_confirmed' }).date, 45, true);
    expect(early).toBe('2026-10-16');
    expect(late).toBe('2026-10-26');
  });
  it('buyerLens uses accepted_on', () => {
    const args = (accepted_on: string | null) => ({
      seller: { udyam_number: 'UDYAM-MH-01-0000001', enterprise_size: 'micro' as const, activity: 'manufacturing' as const },
      buyer: { gstin: null, entity_type: 'company' as const, presumptive_tax: 'no' as const, credit_days: 15, has_written_agreement: false },
      invoice: { invoice_type: 'tax_invoice' as const, issue_date: '2026-09-01', accepted_on, total_paise: 100000, paid_paise: 0, cgst_paise: 0, sgst_paise: 0, igst_paise: 0, reverse_charge: false },
      today: '2026-10-25' as const,
    });
    expect(buyerLens(args('2026-09-10')).msme_due).toBe('2026-09-25');
    expect(buyerLens(args(null)).msme_due).toBe('2026-09-16');
  });
});

describe('instalments', () => {
  it('splits reconcile to the balance for every count and awkward balance', () => {
    for (const bal of [100, 101, 99999, 1180001, 7]) {
      for (const n of [2, 3, 4]) {
        const items = splitEvenly(bal, n, '2026-10-25');
        expect(items.reduce((s, i) => s + i.amount_paise, 0)).toBe(bal);
        if (bal >= 4) expect(validatePlan(items, bal, '2026-10-25')).toEqual([]);
      }
    }
  });
  it('rejects bad plans', () => {
    const t = '2026-10-25';
    expect(validatePlan([{ date: '2026-11-01', amount_paise: 100 }], 100, t).join()).toMatch(/2 to 4/);
    expect(validatePlan([{ date: '2026-11-01', amount_paise: 50 }, { date: '2026-11-05', amount_paise: 50 }], 100, t).join()).toMatch(/7 days/);
    expect(validatePlan([{ date: '2026-11-01', amount_paise: 50 }, { date: '2027-03-01', amount_paise: 50 }], 100, t).join()).toMatch(/90 days/);
    expect(validatePlan([{ date: '2026-11-01', amount_paise: 40 }, { date: '2026-11-20', amount_paise: 50 }], 100, t).join()).toMatch(/add up/);
    expect(INSTALMENT_CONFIG.maxCount).toBe(4);
  });
});

describe('credit limit', () => {
  const base = { billedInWindowPaise: 180_000_00, creditDays: 30, usualDelayDays: 24, manualLimitPaise: null, exposurePaise: 0, newInvoicePaise: 0 };
  it('model limit = daily billing x (credit + delay) x headroom', () => {
    // 1,00,000/day... 18,000,000 paise / 180 = 100,000 paise per day; x 54 days x 1.25
    expect(checkCredit(base).limitPaise).toBe(6_750_000);
  });
  it('flags the amount over the limit and carries the delay', () => {
    const c = checkCredit({ ...base, exposurePaise: 6_000_000, newInvoicePaise: 1_000_000 });
    expect(c).toMatchObject({ exceeded: true, overPaise: 250_000, usualDelayDays: 24 });
  });
  it('manual limit wins; no history means no limit', () => {
    expect(checkCredit({ ...base, manualLimitPaise: 100, newInvoicePaise: 150 })).toMatchObject({ source: 'manual', overPaise: 50 });
    expect(checkCredit({ ...base, billedInWindowPaise: 0, newInvoicePaise: 9e9 }).exceeded).toBe(false);
  });
});
