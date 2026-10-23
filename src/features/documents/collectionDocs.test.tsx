import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CaseDocument,
  LETTER_DISCLAIMER,
  LetterDocument,
  buildCaseModel,
  buildLetterModel,
  type CaseInput,
  type DocInvoice,
  type LetterInput,
} from './collectionDocs';

const inv = (o: Partial<DocInvoice> = {}): DocInvoice => ({
  id: 'i1',
  number: 'INV/26-27/0001',
  invoice_type: 'tax_invoice',
  issue_date: '2026-04-01',
  accepted_on: null,
  due_date: '2026-05-01',
  total_paise: 118000,
  paid_paise: 18000,
  cgst_paise: 9000,
  sgst_paise: 9000,
  igst_paise: 0,
  reverse_charge: false,
  ...o,
});
const party = {
  address: '1 Main Rd',
  gstin: '27AAPFU0939F1ZV',
  phone: '9820000000',
  email: 's@x.test',
};
const base: LetterInput = {
  today: '2026-07-01',
  seller: {
    ...party,
    name: 'Seller Co',
    udyam_number: 'UDYAM-1',
    enterprise_size: 'small',
    activity: 'manufacturing',
    bank_name: 'HDFC',
    bank_account_holder: 'Seller Co',
    bank_account_number: '1234',
    bank_ifsc: 'HDFC0001',
    upi_id: 's@upi',
  },
  buyer: {
    ...party,
    name: 'Buyer Ltd',
    phone: null,
    email: null,
    entity_type: 'company',
    presumptive_tax: 'no',
    credit_days: 30,
    has_written_agreement: true,
  },
  invoices: [inv()],
  deadlineDays: 7,
  includeInterest: false,
};

function withoutDisclaimer(html: string, business: string) {
  return html.split(LETTER_DISCLAIMER(business)).join('');
}

describe('Payment Demand Letter', () => {
  const m = buildLetterModel(base);
  const html = renderToStaticMarkup(
    <LetterDocument model={m} qrDataUrl="data:image/png;base64,x" />,
  );
  it('has the required heading, disclaimer near the top, and never says "legal notice" elsewhere', () => {
    expect(html).toContain('Payment Demand Letter');
    expect(html).toContain(
      'It is not a notice from the GST department and not a legal notice from a lawyer.',
    );
    expect(html.indexOf(LETTER_DISCLAIMER('Seller Co'))).toBeLessThan(html.indexOf('<table'));
    const rest = withoutDisclaimer(html, 'Seller Co').toLowerCase();
    expect(rest).not.toContain('legal notice');
    expect(rest).not.toMatch(/court|prosecut|arrest|police/);
  });
  it('lists number, date, amount, part payments, balance; 7 day deadline; bank, QR, dispute contact', () => {
    expect(m.rows[0]).toMatchObject({
      number: 'INV/26-27/0001',
      partPayments: '₹180.00',
      balance: '₹1,000.00',
    });
    expect(m.deadline).toBe('8 Jul 2026');
    expect(html).toContain('HDFC0001');
    expect(html).toContain('<img');
    expect(html).toContain('If you think something is wrong');
  });
  it('interest is shown separately and added only when ticked', () => {
    expect(m.interestEligible).toBe(true);
    expect(m.interestPaise).toBeGreaterThan(0);
    expect(m.totalPayablePaise).toBe(m.balancePaise);
    const on = buildLetterModel({ ...base, includeInterest: true });
    expect(on.totalPayablePaise).toBe(on.balancePaise + on.interestPaise);
    expect(renderToStaticMarkup(<LetterDocument model={m} />)).toContain('Interest is not added');
  });
  it('no interest block for an ineligible (trading) seller', () => {
    const t = buildLetterModel({ ...base, seller: { ...base.seller, activity: 'trading' } });
    expect(t.interestEligible).toBe(false);
    expect(renderToStaticMarkup(<LetterDocument model={t} />)).not.toContain(
      'Interest, shown separately',
    );
  });
});

describe('Samadhaan case pack', () => {
  const input: CaseInput = {
    today: '2026-07-01',
    seller: base.seller,
    buyer: base.buyer as CaseInput['buyer'],
    invoices: [inv({ accepted_on: '2026-04-02' })],
    reminders: [{ sent_at: '2026-05-10T10:00:00Z', stage: 'overdue_firm', channel: 'whatsapp' }],
    payments: [{ received_on: '2026-05-20', amount_paise: 18000, method: 'upi', reference: 'R1' }],
    disputes: [
      {
        reason: 'short quantity',
        status: 'resolved',
        raised_at: '2026-05-12T00:00:00Z',
        resolved_at: null,
        resolution_note: 'credit note',
      },
    ],
  };
  const html = renderToStaticMarkup(<CaseDocument model={buildCaseModel(input)} />);
  it('is marked for own use and carries acceptance, reminders, payments, disputes, interest, checklist', () => {
    expect(html).toContain('Prepared for your own use');
    expect(html).toContain('2 Apr 2026');
    expect(html).toContain('Firm reminder');
    expect(html).toContain('R1');
    expect(html).toContain('short quantity');
    expect(html).toContain('What MSME Samadhaan generally asks for');
    expect(html.toLowerCase()).not.toContain('legal notice');
  });
  it('flags an assumed acceptance date', () => {
    const h = renderToStaticMarkup(
      <CaseDocument model={buildCaseModel({ ...input, invoices: [inv()] })} />,
    );
    expect(h).toContain('assumed');
  });
});
