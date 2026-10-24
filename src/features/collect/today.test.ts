import { describe, expect, it } from 'vitest';
import { GENERAL_INFO_LINE } from '@/lib/legal';
import { buildToday, type TodayCustomer, type TodayInput, type TodayInvoice } from './today';

const seller = {
  udyam_number: 'UDYAM-1',
  enterprise_size: 'small' as const,
  activity: 'manufacturing' as const,
  legal_name: 'Seller Co',
  phone: '9820000000',
};
const cust = (o: Partial<TodayCustomer> = {}): TodayCustomer => ({
  id: 'c1',
  name: 'Acme',
  gstin: '27AAPFU0939F1ZV',
  entity_type: 'firm',
  presumptive_tax: 'no',
  credit_days: 30,
  has_written_agreement: true,
  tier: 'standard',
  language: 'en',
  phone: '9811111111',
  email: 'a@x.test',
  snoozed_until: null,
  updated_at: 't',
  ...o,
});
const inv = (o: Partial<TodayInvoice> = {}): TodayInvoice => ({
  id: 'i1',
  customer_id: 'c1',
  number: 'INV/26-27/0001',
  invoice_type: 'tax_invoice',
  issue_date: '2026-05-02',
  accepted_on: null,
  due_date: '2026-06-01',
  total_paise: 118000,
  paid_paise: 0,
  cgst_paise: 9000,
  sgst_paise: 9000,
  igst_paise: 0,
  reverse_charge: false,
  status: 'issued',
  disputed: false,
  approved_stages: [],
  updated_at: 't',
  ...o,
});
const input = (today: string, o: Partial<TodayInput> = {}): TodayInput => ({
  today,
  seller,
  invoices: [inv()],
  customers: [cust()],
  sent: [],
  promises: [],
  messagedToday: [],
  ...o,
});

describe('buildToday', () => {
  it('fills the template, adds the lens line from firm stage, and groups by customer', () => {
    const g = buildToday(
      input('2026-06-08', {
        invoices: [inv(), inv({ id: 'i2', number: 'INV/26-27/0002', total_paise: 50000 })],
        sent: [
          { invoice_id: 'i1', stage: 'pre_due' },
          { invoice_id: 'i1', stage: 'due_today' },
          { invoice_id: 'i2', stage: 'pre_due' },
          { invoice_id: 'i2', stage: 'due_today' },
        ],
      }),
    );
    expect(g).toHaveLength(1);
    expect(g[0]!.items).toHaveLength(2);
    expect(g[0]!.primary.invoice.id).toBe('i1');
    expect(g[0]!.message).toContain('₹1,180.00');
    expect(g[0]!.message).toContain('43B(h)');
    expect(g[0]!.message).toContain(GENERAL_INFO_LINE);
  });
  it('no lens line at the friendly stages', () => {
    const g = buildToday(input('2026-05-29'));
    expect(g[0]!.primary.stage).toBe('pre_due');
    expect(g[0]!.message).not.toContain('43B(h)');
  });
  it('snoozed customers, disputes and promises are skipped', () => {
    expect(
      buildToday(input('2026-06-08', { customers: [cust({ snoozed_until: '2026-06-09' })] })),
    ).toHaveLength(0);
    expect(buildToday(input('2026-06-08', { invoices: [inv({ disputed: true })] }))).toHaveLength(
      0,
    );
    expect(
      buildToday(
        input('2026-06-08', { promises: [{ invoice_id: 'i1', promised_for: '2026-06-10' }] }),
      ),
    ).toHaveLength(0);
  });
  it('a pending claim removes the invoice from today', () => {
    expect(buildToday(input('2026-06-08', { pendingClaims: ['i1'] }))).toHaveLength(0);
    expect(buildToday(input('2026-06-08', { pendingClaims: ['other'] }))).toHaveLength(1);
  });
  it('key tier at final needs approval and has no message until approved', () => {
    const sent = (['pre_due', 'due_today', 'overdue_firm'] as const).map((stage) => ({
      invoice_id: 'i1',
      stage,
    }));
    const g = buildToday(input('2026-06-16', { customers: [cust({ tier: 'key' })], sent }));
    expect(g[0]!.primary.needsApproval).toBe(true);
    expect(g[0]!.message).toBeNull();
    const ok = buildToday(
      input('2026-06-16', {
        customers: [cust({ tier: 'key' })],
        sent,
        invoices: [inv({ approved_stages: ['final'] })],
      }),
    );
    expect(ok[0]!.message).toContain('final reminder');
    expect(ok[0]!.callPrompt).toContain('Call the buyer');
  });
  it('uses the customer language (hindi)', () => {
    const g = buildToday(input('2026-05-29', { customers: [cust({ language: 'hi' })] }));
    expect(g[0]!.message).toContain('नमस्ते');
  });
  it('next_steps gives a guide with Samadhaan for an eligible seller and no message', () => {
    const sent = (['pre_due', 'due_today', 'overdue_firm', 'final', 'demand_letter'] as const).map(
      (stage) => ({ invoice_id: 'i1', stage }),
    );
    const g = buildToday(input('2026-07-17', { sent }));
    expect(g[0]!.message).toBeNull();
    expect(g[0]!.guide?.join(' ')).toContain('Samadhaan');
  });
});
