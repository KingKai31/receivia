import { describe, expect, it } from 'vitest';
import { generateGstin } from '@/lib/gstin';
import { fakeClient, hasOp } from '@/lib/service/testing';
import { computeNote } from '@/features/notes/noteService';
import {
  businessProfileSchema,
  formToPatch,
  profileToForm,
  type BusinessProfile,
} from '@/features/settings/businessProfileService';
import {
  EMPTY_CUSTOMER,
  customerSchema,
  customerSummary,
  formToRow,
  listCustomers,
  updateCustomer,
  type Customer,
} from './customerService';

describe('customer form', () => {
  it('defaults presumptive tax to unknown and validates GSTIN live', () => {
    expect(EMPTY_CUSTOMER.presumptive_tax).toBe('unknown');
    expect(customerSchema.safeParse({ ...EMPTY_CUSTOMER, name: 'A' }).success).toBe(true);
    const bad = customerSchema.safeParse({
      ...EMPTY_CUSTOMER,
      name: 'A',
      gstin: '27AAAAA0000A1Z5',
    });
    expect(bad.success).toBe(false);
    expect(customerSchema.safeParse({ ...EMPTY_CUSTOMER, name: ' ' }).success).toBe(false);
    expect(
      customerSchema.safeParse({ ...EMPTY_CUSTOMER, name: 'A', credit_days: '400' }).success,
    ).toBe(false);
  });

  it('derives state from the GSTIN and stamps WhatsApp opt-in time once', () => {
    const g = generateGstin('29');
    const row = formToRow({
      ...EMPTY_CUSTOMER,
      name: 'A',
      gstin: g,
      state_code: '27',
      opt_in_whatsapp: true,
    });
    expect(row.state_code).toBe('29');
    expect(row.opt_in_whatsapp_at).toBeTruthy();
    const again = formToRow(
      { ...EMPTY_CUSTOMER, name: 'A', opt_in_whatsapp: true },
      { opt_in_whatsapp: true, opt_in_whatsapp_at: '2026-01-01T00:00:00Z' },
    );
    expect(again.opt_in_whatsapp_at).toBe('2026-01-01T00:00:00Z');
    expect(formToRow({ ...EMPTY_CUSTOMER, name: 'A' }).opt_in_whatsapp_at).toBeNull();
  });

  it('update is guarded by updated_at', async () => {
    const { client, calls } = fakeClient(() => ({ data: { id: 'c' }, error: null }));
    await updateCustomer(
      { id: 'c', updated_at: 'T', opt_in_whatsapp: false, opt_in_whatsapp_at: null } as Customer,
      { ...EMPTY_CUSTOMER, name: 'B' },
      client,
    );
    expect(hasOp(calls[0]!, 'eq', 'updated_at', 'T')).toBe(true);
  });

  it('lists with search, pagination and org scoping', async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null, count: 0 }));
    await listCustomers({ orgId: 'o', search: 'ac%me', page: 1, pageSize: 10 }, client);
    const c = calls[0]!;
    expect(hasOp(c, 'eq', 'org_id', 'o')).toBe(true);
    expect(hasOp(c, 'range', 10, 19)).toBe(true);
    expect(JSON.stringify(c.ops)).toContain('ac\\\\%me');
  });

  it('total owed is the unpaid part of open invoices', async () => {
    const { client } = fakeClient((c) =>
      c.table === 'invoices'
        ? {
            data: [{ balance_paise: 75000 }, { balance_paise: 50000 }],
            error: null,
          }
        : { data: [], error: null },
    );
    expect(await customerSummary('c', client)).toMatchObject({
      owed: 125000,
      openInvoices: 2,
      payments: [],
    });
  });
});

describe('business profile form', () => {
  const base: BusinessProfile = {
    id: 'p',
    org_id: 'o',
    legal_name: 'Acme',
    trade_name: null,
    gstin: null,
    state_code: '27',
    registration_type: 'unregistered',
    annual_turnover_paise: 0,
    udyam_number: null,
    enterprise_size: null,
    activity: null,
    address: null,
    email: null,
    phone: null,
    bank_name: null,
    bank_account_holder: null,
    bank_account_number: null,
    bank_ifsc: null,
    upi_id: null,
    invoice_prefix: 'INV',
    updated_at: 't',
  };
  it('round-trips and converts typed rupees once', () => {
    const form = { ...profileToForm(base), annual_turnover: '1,25,00,000.50' };
    expect(formToPatch(form).annual_turnover_paise).toBe(1_250_000_050);
    expect(profileToForm({ ...base, annual_turnover_paise: 1_250_000_050 }).annual_turnover).toBe(
      '12500000.50',
    );
  });
  it('validates GSTIN, Udyam, prefix and requires GSTIN for registered businesses', () => {
    const f = profileToForm(base);
    expect(businessProfileSchema.safeParse(f).success).toBe(true);
    expect(businessProfileSchema.safeParse({ ...f, gstin: '27AAAAA0000A1Z5' }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...f, registration_type: 'regular' }).success).toBe(
      false,
    );
    expect(
      businessProfileSchema.safeParse({
        ...f,
        registration_type: 'regular',
        gstin: generateGstin('27'),
      }).success,
    ).toBe(true);
    expect(
      businessProfileSchema.safeParse({ ...f, udyam_number: 'UDYAM-MH-26-0000001' }).success,
    ).toBe(true);
    expect(businessProfileSchema.safeParse({ ...f, udyam_number: 'nope' }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...f, invoice_prefix: 'TOOLONG' }).success).toBe(
      false,
    );
    expect(businessProfileSchema.parse({ ...f, invoice_prefix: 'ab' }).invoice_prefix).toBe('AB');
  });
  it('state comes from the GSTIN', () => {
    const f = {
      ...profileToForm(base),
      registration_type: 'regular' as const,
      gstin: generateGstin('29'),
      state_code: '27',
    };
    expect(formToPatch(f).state_code).toBe('29');
  });
});

describe('credit and debit note amounts', () => {
  const inv = {
    supplier_state_code: '27',
    place_of_supply: '27',
    invoice_type: 'tax_invoice' as const,
    total_paise: 118000,
  };
  const input = {
    type: 'credit' as const,
    reason: 'Return',
    taxable: '500',
    gstRate: 18,
    issueDate: '2026-10-05',
  };
  it('splits CGST/SGST on same-state and IGST on other-state', () => {
    expect(computeNote(inv, input)).toMatchObject({
      taxable_paise: 50000,
      cgst_paise: 4500,
      sgst_paise: 4500,
      igst_paise: 0,
      total_paise: 59000,
    });
    expect(computeNote({ ...inv, place_of_supply: '29' }, input)).toMatchObject({
      igst_paise: 9000,
      cgst_paise: 0,
    });
  });
  it('rejects empty reason, zero amount and a credit above the invoice', () => {
    expect(() => computeNote(inv, { ...input, reason: ' ' })).toThrowError(/reason/);
    expect(() => computeNote(inv, { ...input, taxable: '0' })).toThrowError(/more than zero/);
    expect(() => computeNote(inv, { ...input, taxable: '5000' })).toThrowError(
      /more than the invoice/,
    );
    expect(computeNote(inv, { ...input, type: 'debit', taxable: '5000' }).total_paise).toBe(590000);
  });
  it('bill of supply notes carry no tax', () => {
    expect(computeNote({ ...inv, invoice_type: 'bill_of_supply' }, input)).toMatchObject({
      cgst_paise: 0,
      total_paise: 50000,
    });
  });
});
