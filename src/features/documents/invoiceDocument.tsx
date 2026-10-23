import {
  COMPOSITION_HEADING,
  E_INVOICE_NOTE,
  E_INVOICE_THRESHOLD_PAISE,
  GST_STATES,
} from '@/lib/gst';
import { amountInWordsIndian, formatINR, paise, type Paise } from '@/lib/money';
import type { Customer } from '@/features/customers/customerService';
import type { Invoice, InvoiceLine } from '@/features/invoices/invoiceService';
import type { Note } from '@/features/notes/noteService';
import type { BusinessProfile } from '@/features/settings/businessProfileService';
import { section34Warning } from '@/lib/legal/section34';
import './doc.css';

export const MSME_INTEREST_TEXT =
  'Interest under Sections 15 and 16 of the MSMED Act, 2006 applies to payments made after the agreed period.';

const HEADINGS = {
  tax_invoice: 'Tax Invoice',
  bill_of_supply: 'Bill of Supply',
  invoice: 'Invoice',
} as const;

const stateName = (code: string | null) =>
  code && code in GST_STATES ? `${code} ${GST_STATES[code as keyof typeof GST_STATES]}` : '—';

/** UPI deep link used for the payment QR. Amount is rupees with 2 decimals. */
export function upiUri(args: { vpa: string; payee: string; amount: Paise; note: string }): string {
  const rupees = `${Math.floor(args.amount / 100)}.${String(args.amount % 100).padStart(2, '0')}`;
  const q = new URLSearchParams({
    pa: args.vpa,
    pn: args.payee,
    am: rupees,
    tn: args.note,
    cu: 'INR',
  });
  return `upi://pay?${q.toString()}`;
}

/** Udyam disclosure applies to micro and small enterprises that are not purely trading. */
export function showsMsmeNotice(
  p: Pick<BusinessProfile, 'udyam_number' | 'enterprise_size' | 'activity'>,
) {
  return Boolean(
    p.udyam_number &&
    (p.enterprise_size === 'micro' || p.enterprise_size === 'small') &&
    p.activity !== 'trading',
  );
}

export interface DocLine {
  position: number;
  description: string;
  hsn_sac: string;
  qty: string;
  unit: string;
  rate: string;
  discount: string;
  taxable: string;
  gstRate: string;
  cgst: string;
  sgst: string;
  igst: string;
  total: string;
}

export interface InvoiceDocModel {
  heading: string;
  subheading: string | null;
  number: string;
  imported: boolean;
  issueDate: string;
  dueDate: string;
  supplier: {
    name: string;
    address: string;
    gstin: string;
    state: string;
    email: string;
    phone: string;
  };
  buyer: { name: string; address: string; gstin: string; state: string };
  placeOfSupply: string;
  reverseCharge: 'Yes' | 'No';
  deliveryAddress: string | null;
  showTax: boolean;
  intraState: boolean;
  lines: DocLine[];
  totals: {
    taxable: string;
    cgst: string;
    sgst: string;
    igst: string;
    roundOff: string;
    total: string;
  };
  amountInWords: string;
  balanceDue: string;
  bank: { name: string; holder: string; account: string; ifsc: string; upi: string } | null;
  upi: string | null;
  msmeNotice: { udyam: string; text: string } | null;
  eInvoiceNote: string | null;
  notes: string | null;
}

export interface InvoiceDocInput {
  invoice: Invoice;
  lines: InvoiceLine[];
  supplier: BusinessProfile;
  buyer: Customer;
}

const money = (n: number) => formatINR(paise(n));

export function buildInvoiceDocument({
  invoice: i,
  lines,
  supplier: s,
  buyer: b,
}: InvoiceDocInput): InvoiceDocModel {
  const showTax = i.invoice_type === 'tax_invoice';
  const intraState = i.supplier_state_code === i.place_of_supply;
  const docLines: DocLine[] =
    lines.length > 0
      ? lines.map((l) => ({
          position: l.position,
          description: l.description,
          hsn_sac: l.hsn_sac ?? '',
          qty: String(l.qty),
          unit: l.unit ?? '',
          rate: money(l.rate_paise),
          discount: l.discount_paise ? money(l.discount_paise) : '',
          taxable: money(l.taxable_paise),
          gstRate: showTax ? `${l.gst_rate}%` : '',
          cgst: money(l.cgst_paise),
          sgst: money(l.sgst_paise),
          igst: money(l.igst_paise),
          total: money(l.total_paise),
        }))
      : [
          {
            position: 1,
            description: 'Imported invoice (line details not available)',
            hsn_sac: '',
            qty: '',
            unit: '',
            rate: '',
            discount: '',
            taxable: money(i.taxable_paise),
            gstRate: '',
            cgst: money(i.cgst_paise),
            sgst: money(i.sgst_paise),
            igst: money(i.igst_paise),
            total: money(i.taxable_paise + i.cgst_paise + i.sgst_paise + i.igst_paise),
          },
        ];
  const balance = paise(i.total_paise - i.paid_paise);
  const hasBank = s.bank_account_number || s.upi_id;
  return {
    heading: HEADINGS[i.invoice_type],
    subheading: i.invoice_type === 'bill_of_supply' ? COMPOSITION_HEADING : null,
    number: i.number ?? 'DRAFT',
    imported: i.source === 'import',
    issueDate: i.issue_date,
    dueDate: i.due_date,
    supplier: {
      name: s.legal_name,
      address: s.address ?? '',
      gstin: s.gstin ?? '',
      state: stateName(s.state_code),
      email: s.email ?? '',
      phone: s.phone ?? '',
    },
    buyer: {
      name: b.name,
      address: b.address ?? '',
      gstin: b.gstin ?? 'Unregistered',
      state: stateName(b.state_code),
    },
    placeOfSupply: stateName(i.place_of_supply),
    reverseCharge: i.reverse_charge ? 'Yes' : 'No',
    deliveryAddress: i.delivery_address,
    showTax,
    intraState,
    lines: docLines,
    totals: {
      taxable: money(i.taxable_paise),
      cgst: money(i.cgst_paise),
      sgst: money(i.sgst_paise),
      igst: money(i.igst_paise),
      roundOff: money(i.round_off_paise),
      total: money(i.total_paise),
    },
    amountInWords: amountInWordsIndian(paise(i.total_paise)),
    balanceDue: formatINR(balance),
    bank: hasBank
      ? {
          name: s.bank_name ?? '',
          holder: s.bank_account_holder ?? '',
          account: s.bank_account_number ?? '',
          ifsc: s.bank_ifsc ?? '',
          upi: s.upi_id ?? '',
        }
      : null,
    upi:
      s.upi_id && balance > 0 && i.number
        ? upiUri({ vpa: s.upi_id, payee: s.legal_name, amount: balance, note: i.number })
        : null,
    msmeNotice: showsMsmeNotice(s) ? { udyam: s.udyam_number!, text: MSME_INTEREST_TEXT } : null,
    eInvoiceNote: s.annual_turnover_paise > E_INVOICE_THRESHOLD_PAISE ? E_INVOICE_NOTE : null,
    notes: i.notes,
  };
}

export function InvoiceDocument({
  model: m,
  qrDataUrl,
}: {
  model: InvoiceDocModel;
  qrDataUrl?: string;
}) {
  return (
    <article className="doc-page" aria-label={m.heading}>
      <header className="doc-head">
        <h1 className="doc-title">{m.heading}</h1>
        {m.subheading ? <p className="doc-sub">{m.subheading}</p> : null}
        {m.imported ? <p className="doc-sub">Imported record</p> : null}
      </header>

      <section className="doc-grid">
        <div>
          <h2>Supplier</h2>
          <p>
            <strong>{m.supplier.name}</strong>
            <br />
            {m.supplier.address}
            <br />
            {m.supplier.gstin ? (
              <>
                GSTIN: {m.supplier.gstin}
                <br />
              </>
            ) : null}
            State: {m.supplier.state}
            {m.supplier.phone ? (
              <>
                <br />
                Phone: {m.supplier.phone}
              </>
            ) : null}
            {m.supplier.email ? (
              <>
                <br />
                Email: {m.supplier.email}
              </>
            ) : null}
          </p>
        </div>
        <div>
          <h2>Invoice details</h2>
          <p>
            Number: <strong>{m.number}</strong>
            <br />
            Date: {m.issueDate}
            <br />
            Due date: {m.dueDate}
            <br />
            Reverse charge: {m.reverseCharge}
          </p>
        </div>
        <div>
          <h2>Bill to</h2>
          <p>
            <strong>{m.buyer.name}</strong>
            <br />
            {m.buyer.address}
            <br />
            GSTIN: {m.buyer.gstin}
            <br />
            State: {m.buyer.state}
          </p>
        </div>
        <div>
          <h2>Place of supply</h2>
          <p>{m.placeOfSupply}</p>
          {m.deliveryAddress ? <p>Delivery address: {m.deliveryAddress}</p> : null}
        </div>
      </section>

      <table className="doc-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th>HSN/SAC</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Discount</th>
            <th>Taxable value</th>
            {m.showTax ? <th>GST rate</th> : null}
            {m.showTax && m.intraState ? (
              <>
                <th>CGST</th>
                <th>SGST</th>
              </>
            ) : null}
            {m.showTax && !m.intraState ? <th>IGST</th> : null}
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {m.lines.map((l) => (
            <tr key={l.position}>
              <td>{l.position}</td>
              <td>{l.description}</td>
              <td>{l.hsn_sac}</td>
              <td>
                {l.qty} {l.unit}
              </td>
              <td>{l.rate}</td>
              <td>{l.discount}</td>
              <td>{l.taxable}</td>
              {m.showTax ? <td>{l.gstRate}</td> : null}
              {m.showTax && m.intraState ? (
                <>
                  <td>{l.cgst}</td>
                  <td>{l.sgst}</td>
                </>
              ) : null}
              {m.showTax && !m.intraState ? <td>{l.igst}</td> : null}
              <td>{l.total}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="doc-totals">
        <dl>
          <dt>Taxable value</dt>
          <dd>{m.totals.taxable}</dd>
          {m.showTax && m.intraState ? (
            <>
              <dt>CGST</dt>
              <dd>{m.totals.cgst}</dd>
              <dt>SGST</dt>
              <dd>{m.totals.sgst}</dd>
            </>
          ) : null}
          {m.showTax && !m.intraState ? (
            <>
              <dt>IGST</dt>
              <dd>{m.totals.igst}</dd>
            </>
          ) : null}
          <dt>Round off</dt>
          <dd>{m.totals.roundOff}</dd>
          <dt>
            <strong>Total</strong>
          </dt>
          <dd>
            <strong>{m.totals.total}</strong>
          </dd>
        </dl>
      </section>
      <p>
        <strong>Amount in words:</strong> {m.amountInWords}
      </p>
      {m.notes ? <p>Notes: {m.notes}</p> : null}

      <section className="doc-grid">
        {m.bank ? (
          <div>
            <h2>Pay to</h2>
            <p>
              {m.bank.holder ? (
                <>
                  Account holder: {m.bank.holder}
                  <br />
                </>
              ) : null}
              {m.bank.name ? (
                <>
                  Bank: {m.bank.name}
                  <br />
                </>
              ) : null}
              {m.bank.account ? (
                <>
                  Account number: {m.bank.account}
                  <br />
                </>
              ) : null}
              {m.bank.ifsc ? (
                <>
                  IFSC: {m.bank.ifsc}
                  <br />
                </>
              ) : null}
              {m.bank.upi ? <>UPI: {m.bank.upi}</> : null}
            </p>
          </div>
        ) : null}
        {qrDataUrl ? (
          <div>
            <h2>Scan to pay {m.balanceDue}</h2>
            <img src={qrDataUrl} alt="UPI payment QR code" width={120} height={120} />
          </div>
        ) : null}
      </section>

      {m.msmeNotice ? (
        <p className="doc-fine">
          Udyam registration number: {m.msmeNotice.udyam}. {m.msmeNotice.text}
        </p>
      ) : null}
      {m.eInvoiceNote ? <p className="doc-fine">{m.eInvoiceNote}</p> : null}

      <footer className="doc-sign">
        <p>For {m.supplier.name}</p>
        <p className="doc-sign-line">Authorised signatory</p>
      </footer>
    </article>
  );
}

export interface NoteDocModel {
  heading: string;
  number: string;
  issueDate: string;
  invoiceNumber: string;
  invoiceDate: string;
  reason: string;
  supplier: InvoiceDocModel['supplier'];
  buyer: InvoiceDocModel['buyer'];
  showTax: boolean;
  intraState: boolean;
  totals: { taxable: string; cgst: string; sgst: string; igst: string; total: string };
  amountInWords: string;
  section34: string | null;
}

export function buildNoteDocument(args: {
  note: Note;
  invoice: Invoice;
  supplier: BusinessProfile;
  buyer: Customer;
  today: string;
}): NoteDocModel {
  const { note: n, invoice: i, supplier: s, buyer: b } = args;
  const base = buildInvoiceDocument({ invoice: i, lines: [], supplier: s, buyer: b });
  return {
    heading: n.note_type === 'credit' ? 'Credit Note' : 'Debit Note',
    number: n.number ?? 'DRAFT',
    issueDate: n.issue_date,
    invoiceNumber: i.number ?? '',
    invoiceDate: i.issue_date,
    reason: n.reason ?? '',
    supplier: base.supplier,
    buyer: base.buyer,
    showTax: base.showTax,
    intraState: base.intraState,
    totals: {
      taxable: money(n.taxable_paise),
      cgst: money(n.cgst_paise),
      sgst: money(n.sgst_paise),
      igst: money(n.igst_paise),
      total: money(n.total_paise),
    },
    amountInWords: amountInWordsIndian(paise(n.total_paise)),
    section34: n.note_type === 'credit' ? section34Warning(i.issue_date, args.today).text : null,
  };
}

export function NoteDocument({ model: m }: { model: NoteDocModel }) {
  return (
    <article className="doc-page" aria-label={m.heading}>
      <header className="doc-head">
        <h1 className="doc-title">{m.heading}</h1>
      </header>
      <section className="doc-grid">
        <div>
          <h2>Supplier</h2>
          <p>
            <strong>{m.supplier.name}</strong>
            <br />
            {m.supplier.address}
            <br />
            {m.supplier.gstin ? <>GSTIN: {m.supplier.gstin}</> : null}
          </p>
        </div>
        <div>
          <h2>Note details</h2>
          <p>
            Number: <strong>{m.number}</strong>
            <br />
            Date: {m.issueDate}
            <br />
            Against invoice: {m.invoiceNumber} dated {m.invoiceDate}
          </p>
        </div>
        <div>
          <h2>Customer</h2>
          <p>
            <strong>{m.buyer.name}</strong>
            <br />
            {m.buyer.address}
            <br />
            GSTIN: {m.buyer.gstin}
          </p>
        </div>
        <div>
          <h2>Reason</h2>
          <p>{m.reason}</p>
        </div>
      </section>
      <section className="doc-totals">
        <dl>
          <dt>Taxable value</dt>
          <dd>{m.totals.taxable}</dd>
          {m.showTax && m.intraState ? (
            <>
              <dt>CGST</dt>
              <dd>{m.totals.cgst}</dd>
              <dt>SGST</dt>
              <dd>{m.totals.sgst}</dd>
            </>
          ) : null}
          {m.showTax && !m.intraState ? (
            <>
              <dt>IGST</dt>
              <dd>{m.totals.igst}</dd>
            </>
          ) : null}
          <dt>
            <strong>Total</strong>
          </dt>
          <dd>
            <strong>{m.totals.total}</strong>
          </dd>
        </dl>
      </section>
      <p>
        <strong>Amount in words:</strong> {m.amountInWords}
      </p>
      {m.section34 ? <p className="doc-fine">{m.section34}</p> : null}
      <footer className="doc-sign">
        <p>For {m.supplier.name}</p>
        <p className="doc-sign-line">Authorised signatory</p>
      </footer>
    </article>
  );
}
