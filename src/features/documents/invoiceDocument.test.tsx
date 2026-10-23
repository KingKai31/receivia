import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Customer } from '@/features/customers/customerService';
import type { Invoice, InvoiceLine } from '@/features/invoices/invoiceService';
import type { Note } from '@/features/notes/noteService';
import type { BusinessProfile } from '@/features/settings/businessProfileService';
import { generateGstin } from '@/lib/gstin';
import {
  InvoiceDocument,
  MSME_INTEREST_TEXT,
  NoteDocument,
  buildInvoiceDocument,
  buildNoteDocument,
  showsMsmeNotice,
  upiUri,
} from './invoiceDocument';

const supplierGstin = generateGstin('27');
const buyerGstin = generateGstin('29');

const profile = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  id: 'p',
  org_id: 'o',
  legal_name: 'Acme Traders',
  trade_name: null,
  gstin: supplierGstin,
  state_code: '27',
  registration_type: 'regular',
  annual_turnover_paise: 0,
  udyam_number: null,
  enterprise_size: null,
  activity: null,
  address: '1 Main Road, Pune',
  email: 'a@acme.in',
  phone: '9800000000',
  bank_name: 'HDFC',
  bank_account_holder: 'Acme Traders',
  bank_account_number: '1234567890',
  bank_ifsc: 'HDFC0001234',
  upi_id: 'acme@hdfcbank',
  invoice_prefix: 'INV',
  updated_at: 't',
  ...over,
});
const buyer = (over: Partial<Customer> = {}): Customer =>
  ({
    id: 'c',
    name: 'Buyer Co',
    gstin: buyerGstin,
    state_code: '29',
    address: '9 Lake Rd, Bengaluru',
    ...over,
  }) as Customer;

const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: 'i',
    customer_id: 'c',
    number: 'INV/26-27/0007',
    invoice_type: 'tax_invoice',
    status: 'issued',
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
    supplier_state_code: '27',
    place_of_supply: '29',
    taxable_paise: 100000,
    cgst_paise: 0,
    sgst_paise: 0,
    igst_paise: 18000,
    round_off_paise: 0,
    total_paise: 118000,
    paid_paise: 0,
    notes: null,
    source: 'manual',
    reverse_charge: true,
    delivery_address: 'Dock 4, Hosur',
    ...over,
  }) as Invoice;
const lines: InvoiceLine[] = [
  {
    id: 'l',
    position: 1,
    description: 'Valve',
    hsn_sac: '8481',
    qty: 2,
    unit: 'Nos',
    rate_paise: 50000,
    discount_paise: 0,
    gst_rate: 18,
    taxable_paise: 100000,
    cgst_paise: 0,
    sgst_paise: 0,
    igst_paise: 18000,
    total_paise: 118000,
  },
];

const html = (inv: Invoice, p: BusinessProfile, b = buyer()) =>
  renderToStaticMarkup(
    <InvoiceDocument
      model={buildInvoiceDocument({ invoice: inv, lines, supplier: p, buyer: b })}
      qrDataUrl="data:image/png;base64,AA"
    />,
  );

describe('invoice document: required fields', () => {
  it('Tax Invoice (other state) shows every required field', () => {
    const h = html(invoice(), profile());
    for (const needle of [
      'Tax Invoice',
      'Acme Traders',
      '1 Main Road, Pune',
      supplierGstin,
      'INV/26-27/0007',
      '2026-10-01',
      'Buyer Co',
      '9 Lake Rd, Bengaluru',
      buyerGstin,
      '29 Karnataka',
      'Reverse charge: Yes',
      'Dock 4, Hosur',
      '8481',
      'Valve',
      '2 Nos',
      '₹500.00',
      'IGST',
      '18%',
      '₹1,180.00',
      'Round off',
      'Rupees One Thousand One Hundred Eighty Only',
      'Authorised signatory',
      'HDFC0001234',
      'acme@hdfcbank',
      'UPI payment QR code',
    ])
      expect(h, needle).toContain(needle);
    expect(h).not.toContain('CGST');
  });

  it('Tax Invoice (same state) shows CGST and SGST, not IGST', () => {
    const h = html(
      invoice({ place_of_supply: '27', igst_paise: 0, cgst_paise: 9000, sgst_paise: 9000 }),
      profile(),
      buyer({ gstin: generateGstin('27'), state_code: '27' }),
    );
    expect(h).toContain('CGST');
    expect(h).toContain('SGST');
    expect(h).not.toContain('IGST');
  });

  it('Bill of Supply carries the composition heading and no tax columns', () => {
    const h = html(
      invoice({
        invoice_type: 'bill_of_supply',
        igst_paise: 0,
        total_paise: 100000,
        place_of_supply: '27',
        reverse_charge: false,
        delivery_address: null,
      }),
      profile({ registration_type: 'composition' }),
    );
    expect(h).toContain('Bill of Supply');
    expect(h).toContain('Composition taxable person, not eligible to collect tax on supplies');
    expect(h).not.toContain('IGST');
    expect(h).not.toContain('CGST');
    expect(h).not.toContain('GST rate');
    expect(h).toContain('Rupees One Thousand Only');
  });

  it('plain invoice for an unregistered supplier has no GSTIN and no tax columns', () => {
    const h = html(
      invoice({ invoice_type: 'invoice', igst_paise: 0, total_paise: 100000 }),
      profile({ registration_type: 'unregistered', gstin: null }),
      buyer({ gstin: null }),
    );
    expect(h).toContain('>Invoice<');
    expect(h).not.toContain('Tax Invoice');
    expect(h).not.toContain(
      'Supplier</h2><p><strong>Acme Traders</strong><br/>1 Main Road, Pune<br/>GSTIN',
    );
    expect(h).toContain('Unregistered');
    expect(h).not.toContain('IGST');
  });

  it('prints the round-off line for a non-whole-rupee subtotal', () => {
    const h = html(
      invoice({
        round_off_paise: -30,
        taxable_paise: 100030,
        total_paise: 118000 - 0,
        igst_paise: 18000,
      }),
      profile(),
    );
    expect(h).toContain('-₹0.30');
  });
});

describe('MSME and e-invoice notices', () => {
  const msme = {
    udyam_number: 'UDYAM-MH-26-0000001',
    enterprise_size: 'small' as const,
    activity: 'manufacturing' as const,
  };
  it('prints Udyam number and interest line for micro/small non-traders', () => {
    const h = html(invoice(), profile(msme));
    expect(h).toContain('UDYAM-MH-26-0000001');
    expect(h).toContain(MSME_INTEREST_TEXT);
    expect(showsMsmeNotice({ ...msme, enterprise_size: 'micro', activity: 'services' })).toBe(true);
  });
  it('does not print it for traders, medium enterprises or missing Udyam number', () => {
    expect(showsMsmeNotice({ ...msme, activity: 'trading' })).toBe(false);
    expect(showsMsmeNotice({ ...msme, enterprise_size: 'medium' })).toBe(false);
    expect(showsMsmeNotice({ ...msme, udyam_number: null })).toBe(false);
    expect(html(invoice(), profile({ ...msme, activity: 'trading' }))).not.toContain('MSMED');
  });
  it('adds the e-invoice note only above ₹5 crore turnover', () => {
    expect(html(invoice(), profile({ annual_turnover_paise: 5_000_000_001 }))).toContain(
      'e-invoicing may apply',
    );
    expect(html(invoice(), profile({ annual_turnover_paise: 5_000_000_000 }))).not.toContain(
      'e-invoicing',
    );
  });
});

describe('UPI link', () => {
  it('has pa, pn, am, tn and cu=INR', () => {
    const u = upiUri({
      vpa: 'acme@hdfcbank',
      payee: 'Acme Traders',
      amount: 118050 as never,
      note: 'INV/26-27/0007',
    });
    const q = new URL(u).searchParams;
    expect(u.startsWith('upi://pay?')).toBe(true);
    expect(q.get('pa')).toBe('acme@hdfcbank');
    expect(q.get('pn')).toBe('Acme Traders');
    expect(q.get('am')).toBe('1180.50');
    expect(q.get('tn')).toBe('INV/26-27/0007');
    expect(q.get('cu')).toBe('INR');
  });
  it('is absent for drafts and fully paid invoices', () => {
    const m = (i: Invoice) =>
      buildInvoiceDocument({ invoice: i, lines, supplier: profile(), buyer: buyer() });
    expect(m(invoice()).upi).not.toBeNull();
    expect(m(invoice({ number: null, status: 'draft' })).upi).toBeNull();
    expect(m(invoice({ paid_paise: 118000 })).upi).toBeNull();
  });
});

describe('note document', () => {
  const note = {
    id: 'n',
    note_type: 'credit',
    number: 'CN/26-27/0001',
    issue_date: '2026-10-05',
    reason: 'Goods returned',
    taxable_paise: 10000,
    cgst_paise: 0,
    sgst_paise: 0,
    igst_paise: 1800,
    total_paise: 11800,
    status: 'issued',
  } as Note;
  it('credit note shows reference invoice, reason, amount in words and the hedged Section 34 line', () => {
    const m = buildNoteDocument({
      note,
      invoice: invoice(),
      supplier: profile(),
      buyer: buyer(),
      today: '2026-10-10',
    });
    const h = renderToStaticMarkup(<NoteDocument model={m} />);
    for (const n of [
      'Credit Note',
      'CN/26-27/0001',
      'INV/26-27/0007',
      'Goods returned',
      'Rupees One Hundred Eighteen Only',
      'Section 34',
      'General information, not legal or tax advice.',
    ])
      expect(h, n).toContain(n);
  });
  it('debit note has no Section 34 warning', () => {
    const m = buildNoteDocument({
      note: { ...note, note_type: 'debit' },
      invoice: invoice(),
      supplier: profile(),
      buyer: buyer(),
      today: '2026-10-10',
    });
    expect(m.heading).toBe('Debit Note');
    expect(m.section34).toBeNull();
  });
});
