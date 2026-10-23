import { describe, expect, it } from 'vitest';
import { fakeClient, hasOp } from '@/lib/service/testing';
import { generateGstin } from '@/lib/gstin';
import { computeDraft, displayStatus, parseQty, type DraftInput } from './invoiceModel';
import {
  describeTimelineEntry,
  issueInvoice,
  listInvoices,
  saveDraft,
  type Invoice,
} from './invoiceService';

const input = (over: Partial<DraftInput> = {}): DraftInput => ({
  customerId: 'c1',
  issueDate: '2026-10-01',
  creditDays: 30,
  reverseCharge: false,
  deliveryAddress: '',
  notes: '',
  lines: [
    {
      description: 'Widget',
      hsn_sac: '8481',
      qty: '2',
      unit: 'Nos',
      rate: '500.00',
      discount: '',
      gst_rate: 18,
    },
    {
      description: 'Service',
      hsn_sac: '9983',
      qty: '1',
      unit: '',
      rate: '1000',
      discount: '100',
      gst_rate: 5,
    },
  ],
  ...over,
});
const supplier = { stateCode: '27', registrationType: 'regular' as const };

describe('computeDraft', () => {
  it('same state: CGST + SGST, due date from credit days, FY from date', () => {
    const c = computeDraft(input(), supplier, { gstin: generateGstin('27'), state_code: '27' });
    expect(c.calc.intraState).toBe(true);
    expect(c.calc.igst).toBe(0);
    // 2 x 500 at 18% = 180 ; (1000 - 100) at 5% = 45 -> tax 225, taxable 1900
    expect(c.calc.taxable).toBe(190000);
    expect(c.calc.cgst + c.calc.sgst).toBe(22500);
    expect(c.calc.grandTotal).toBe(212500);
    expect(c.dueDate).toBe('2026-10-31');
    expect(c.fy).toBe('26-27');
  });

  it('other state: IGST only', () => {
    const c = computeDraft(input(), supplier, { gstin: generateGstin('29'), state_code: '29' });
    expect(c.calc.intraState).toBe(false);
    expect(c.calc.cgst + c.calc.sgst).toBe(0);
    expect(c.calc.igst).toBe(22500);
    expect(c.placeOfSupply).toBe('29');
  });

  it('a manual due date overrides credit days', () => {
    const c = computeDraft(input({ dueDate: '2026-12-01' }), supplier, {
      gstin: null,
      state_code: '27',
    });
    expect(c.dueDate).toBe('2026-12-01');
  });

  it('rejects bad input with a typed validation error naming the line', () => {
    const bad = input({ lines: [{ ...input().lines[0]!, description: ' ' }] });
    expect(() => computeDraft(bad, supplier, { gstin: null, state_code: '27' })).toThrowError(
      /Line 1: description/,
    );
    expect(() =>
      computeDraft(input({ lines: [] }), supplier, { gstin: null, state_code: '27' }),
    ).toThrowError(/at least one line/);
    expect(() => parseQty('1.2345')).toThrowError(/Quantity/);
  });
});

describe('displayStatus', () => {
  const base = { status: 'issued', due_date: '2026-11-10', disputed: false };
  const today = '2026-11-01';
  it('shows one word per state', () => {
    expect(displayStatus({ ...base, status: 'draft' }, today)).toBe('draft');
    expect(displayStatus(base, today)).toBe('issued');
    expect(displayStatus({ ...base, due_date: '2026-11-05' }, today)).toBe('due soon');
    expect(displayStatus({ ...base, due_date: '2026-10-31' }, today)).toBe('overdue');
    expect(displayStatus({ ...base, status: 'partially_paid' }, today)).toBe('part paid');
    expect(
      displayStatus({ ...base, status: 'partially_paid', due_date: '2026-10-01' }, today),
    ).toBe('overdue');
    expect(displayStatus({ ...base, status: 'paid', due_date: '2026-10-01' }, today)).toBe('paid');
    expect(displayStatus({ ...base, disputed: true }, today)).toBe('disputed');
  });
});

describe('invoice service', () => {
  const stub = { id: 'i1', updated_at: 't1' } as Invoice;

  it('saveDraft sends computed amounts to save_invoice with no number', async () => {
    const { client, calls } = fakeClient(() => ({ data: stub, error: null }));
    await saveDraft({
      orgId: 'o1',
      input: input(),
      supplier,
      buyer: { gstin: null, state_code: '27' },
      client,
    });
    const c = calls[0]!;
    expect(c.rpc).toBe('save_invoice');
    const a = c.args as { p_id: unknown; p_header: Record<string, unknown>; p_lines: unknown[] };
    expect(a.p_id).toBeNull();
    expect(a.p_header).toMatchObject({
      invoice_type: 'tax_invoice',
      total_paise: 212500,
      fy: '26-27',
    });
    expect(a.p_header).not.toHaveProperty('number');
    expect(a.p_lines).toHaveLength(2);
  });

  it('issueInvoice passes the loaded updated_at and maps a conflict', async () => {
    const ok = fakeClient(() => ({ data: { ...stub, number: 'INV/26-27/0001' }, error: null }));
    expect((await issueInvoice(stub, ok.client)).number).toBe('INV/26-27/0001');
    expect(ok.calls[0]!.args).toEqual({ p_invoice: 'i1', p_expected: 't1' });
    const bad = fakeClient(() => ({ data: null, error: { code: '40001', message: 'conflict' } }));
    await expect(issueInvoice(stub, bad.client)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('listInvoices turns display statuses into database filters and pages', async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null, count: 0 }));
    await listInvoices({ orgId: 'o', status: 'overdue', today: '2026-11-01', page: 2 }, client);
    const c = calls[0]!;
    expect(hasOp(c, 'eq', 'org_id', 'o')).toBe(true);
    expect(hasOp(c, 'lt', 'due_date', '2026-11-01')).toBe(true);
    expect(hasOp(c, 'range', 50, 74)).toBe(true);
    await listInvoices({ orgId: 'o', minDaysOverdue: 30, today: '2026-11-01' }, client);
    expect(hasOp(calls[1]!, 'lte', 'due_date', '2026-10-02')).toBe(true);
  });

  it('describes audit rows in words', () => {
    const e = (old: object | null, nw: object, action = 'UPDATE', table = 'invoices') => ({
      id: '1',
      created_at: '',
      action,
      table_name: table,
      old_data: old as never,
      new_data: nw as never,
    });
    expect(describeTimelineEntry(e(null, { source: 'manual' }, 'INSERT'))).toBe('Draft created');
    expect(
      describeTimelineEntry(e({ status: 'draft' }, { status: 'issued', number: 'INV/26-27/0001' })),
    ).toBe('Issued as INV/26-27/0001');
    expect(describeTimelineEntry(e(null, { note_type: 'credit' }, 'INSERT', 'notes'))).toBe(
      'Credit note drafted',
    );
  });
});
