import { tr } from '@/app/i18n';
import { useTranslation } from 'react-i18next';
import { addDays, type ISODate } from '@/lib/dates';
import {
  buyerLens,
  msmeDueDate,
  msmeEligibility,
  msmedInterest,
  GENERAL_INFO_LINE,
} from '@/lib/legal';
import type { BuyerFacts, SellerFacts } from '@/lib/legal';
import { formatINR, paise, type Paise } from '@/lib/money';
import { prettyDate } from '@/features/collect/today';
import { STAGE_LABEL, type Stage } from '@/features/collect/ladder';
import './doc.css';

export const LETTER_DISCLAIMER = (business: string) =>
  `This letter is from ${business} about money owed for the invoices listed below. It is not a notice from the GST department and not a legal notice from a lawyer.`;

export interface DocParty {
  name: string;
  address: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
}

export interface DocInvoice {
  id: string;
  number: string;
  invoice_type: 'tax_invoice' | 'bill_of_supply' | 'invoice';
  issue_date: ISODate;
  accepted_on: ISODate | null;
  due_date: ISODate;
  total_paise: number;
  paid_paise: number;
  credited_paise?: number;
  tds_paise?: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  reverse_charge: boolean;
}

export interface BankDetails {
  bank_name: string | null;
  bank_account_holder: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  upi_id: string | null;
}

export interface LetterInput {
  today: ISODate;
  seller: DocParty & SellerFacts & BankDetails;
  buyer: DocParty & BuyerFacts;
  invoices: DocInvoice[];
  deadlineDays: number;
  includeInterest: boolean;
}

export interface LetterRow {
  number: string;
  date: string;
  amount: string;
  partPayments: string;
  balance: string;
  balancePaise: number;
  interestPaise: number;
}

export interface LetterModel {
  title: 'Payment Demand Letter';
  disclaimer: string;
  date: string;
  deadline: string;
  seller: LetterInput['seller'];
  buyer: DocParty;
  rows: LetterRow[];
  balancePaise: Paise;
  interestEligible: boolean;
  interestPaise: Paise;
  interestNote: string | null;
  includeInterest: boolean;
  totalPayablePaise: Paise;
  lensLines: string[];
  upiAmount: Paise;
}

export function buildLetterModel(i: LetterInput): LetterModel {
  const eligible = msmeEligibility(i.seller).applies;
  const rows: LetterRow[] = i.invoices.map((inv) => {
    const bal = Math.max(
      inv.total_paise - inv.paid_paise - (inv.credited_paise ?? 0) - (inv.tds_paise ?? 0),
      0,
    );
    const due = msmeDueDate(
      inv.accepted_on ?? inv.issue_date,
      i.buyer.credit_days,
      i.buyer.has_written_agreement,
    );
    const interest = eligible
      ? msmedInterest({ principal: paise(bal), dueDate: due, asOf: i.today }).interest_paise
      : 0;
    return {
      number: inv.number,
      date: prettyDate(inv.issue_date),
      amount: formatINR(paise(inv.total_paise)),
      partPayments: formatINR(paise(inv.total_paise - bal)),
      balance: formatINR(paise(bal)),
      balancePaise: bal,
      interestPaise: interest,
    };
  });
  const balance = paise(rows.reduce((s, r) => s + r.balancePaise, 0));
  const interest = paise(rows.reduce((s, r) => s + r.interestPaise, 0));
  const interestShown = eligible && interest > 0;
  const lens = new Set<string>();
  for (const inv of i.invoices) {
    const l = buyerLens({ seller: i.seller, buyer: i.buyer, invoice: inv, today: i.today });
    if (l.line_en) lens.add(l.line_en);
  }
  const addInterest = interestShown && i.includeInterest;
  const total = paise(balance + (addInterest ? interest : 0));
  return {
    title: 'Payment Demand Letter',
    disclaimer: LETTER_DISCLAIMER(i.seller.name),
    date: prettyDate(i.today),
    deadline: prettyDate(addDays(i.today, i.deadlineDays)),
    seller: i.seller,
    buyer: i.buyer,
    rows,
    balancePaise: balance,
    interestEligible: interestShown,
    interestPaise: interest,
    interestNote: interestShown
      ? 'MSMED Act interest (Section 16, three times the RBI bank rate, compounded monthly). Shown separately; it is included in the amount to pay only if the sender chooses to claim it.'
      : null,
    includeInterest: addInterest,
    totalPayablePaise: total,
    lensLines: [...lens],
    upiAmount: total,
  };
}

export function LetterDocument({
  model: m,
  qrDataUrl,
}: {
  model: LetterModel;
  qrDataUrl?: string;
}) {
  const { t } = useTranslation();
  const s = m.seller;
  return (
    <article className="doc-page" aria-label={tr(m.title)}>
      <header className="doc-head">
        <h1 className="doc-title">{tr(m.title)}</h1>
        <p className="doc-sub">{tr(m.disclaimer)}</p>
      </header>
      <section className="doc-grid">
        <div>
          <h2>{t('From')}</h2>
          <p>
            <strong>{s.name}</strong>
            <br />
            {s.address}
            {s.gstin ? (
              <>
                <br />
                {t('GSTIN: {{gstin}}', { gstin: s.gstin })}
              </>
            ) : null}
            {s.phone ? (
              <>
                <br />
                {t('Phone: {{phone}}', { phone: s.phone })}
              </>
            ) : null}
            {s.email ? (
              <>
                <br />
                {t('Email: {{email}}', { email: s.email })}
              </>
            ) : null}
          </p>
        </div>
        <div>
          <h2>{t('To')}</h2>
          <p>
            <strong>{m.buyer.name}</strong>
            <br />
            {m.buyer.address}
            {m.buyer.gstin ? (
              <>
                <br />
                {t('GSTIN: {{gstin}}', { gstin: m.buyer.gstin })}
              </>
            ) : null}
          </p>
          <p>
            {t('Date:')} {m.date}
          </p>
        </div>
      </section>

      <p>
        {t(
          'Dear {{name}}, our records show that the invoices below have not been paid in full. Please pay the balance of {{formatINR}} by',
          { name: m.buyer.name, formatINR: formatINR(m.balancePaise) },
        )}{' '}
        <strong>{m.deadline}</strong>
        {t('.')}
      </p>

      <table className="doc-table">
        <thead>
          <tr>
            <th>{t('Invoice number')}</th>
            <th>{t('Date')}</th>
            <th>{t('Amount')}</th>
            <th>{t('Payments and credits')}</th>
            <th>{t('Balance')}</th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r) => (
            <tr key={r.number}>
              <td>{r.number}</td>
              <td>{r.date}</td>
              <td>{r.amount}</td>
              <td>{r.partPayments}</td>
              <td>{r.balance}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="doc-totals">
        <p>
          {t('Balance of invoices:')} <strong>{formatINR(m.balancePaise)}</strong>
        </p>
        {m.interestEligible ? (
          <>
            <p>
              {t('Interest, shown separately:')} {formatINR(m.interestPaise)}
            </p>
            <p className="doc-fine">{tr(m.interestNote ?? '')}</p>
            <p>
              {m.includeInterest
                ? t('Interest is added to the amount below.')
                : t('Interest is not added to the amount below.')}
            </p>
          </>
        ) : null}
        <p>
          {t('Amount to pay:')} <strong>{formatINR(m.totalPayablePaise)}</strong>
        </p>
      </section>

      <section>
        <h2>{t('How to pay')}</h2>
        <p>
          {s.bank_name ? (
            <>
              {t('Bank: {{bank_name}}', { bank_name: s.bank_name })}
              <br />
            </>
          ) : null}
          {s.bank_account_holder ? (
            <>
              {t('Account name: {{bank_account_holder}}', {
                bank_account_holder: s.bank_account_holder,
              })}
              <br />
            </>
          ) : null}
          {s.bank_account_number ? (
            <>
              {t('Account number: {{bank_account_number}}', {
                bank_account_number: s.bank_account_number,
              })}
              <br />
            </>
          ) : null}
          {s.bank_ifsc ? (
            <>
              {t('IFSC: {{bank_ifsc}}', { bank_ifsc: s.bank_ifsc })}
              <br />
            </>
          ) : null}
          {s.upi_id ? (
            <>
              {t('UPI:')} {s.upi_id}
            </>
          ) : null}
        </p>
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={t('UPI QR code for the amount to pay')}
            width={140}
            height={140}
          />
        ) : null}
      </section>

      <section>
        <h2>{t('If you think something is wrong')}</h2>
        <p>
          {t(
            'If you believe any amount above is incorrect, or you have already paid, please tell us by',
          )}{' '}
          {m.deadline}
          {s.phone || s.email ? (
            <>
              {' '}
              {t('at')} {[s.phone, s.email].filter(Boolean).join(' or ')}
            </>
          ) : null}
          {t(', and we will look into it.')}
        </p>
      </section>

      {m.lensLines.length ? (
        <section>
          <h2>{t('For your accounts')}</h2>
          {m.lensLines.map((l) => (
            <p key={l} className="doc-fine">
              {l}
            </p>
          ))}
        </section>
      ) : null}

      <p>
        {t('Yours sincerely,')}
        <br />
        {s.name}
      </p>
    </article>
  );
}

// ---- Case pack ------------------------------------------------------------

const INTEREST_NOTE =
  'Interest is calculated under Section 16 of the MSMED Act at three times the RBI bank rate, compounded monthly, from each MSME due date. Check the current bank rate at rbi.org.in.';

export interface CaseInput {
  today: ISODate;
  seller: DocParty & SellerFacts & BankDetails;
  buyer: DocParty & BuyerFacts & { entity_type: string | null };
  invoices: DocInvoice[];
  reminders: { sent_at: string; stage: Stage; channel: string }[];
  payments: {
    received_on: string;
    amount_paise: number;
    method: string;
    reference: string | null;
  }[];
  disputes: {
    reason: string;
    status: string;
    raised_at: string;
    resolved_at: string | null;
    resolution_note: string | null;
  }[];
}

export interface CaseModel {
  banner: string;
  disclaimer: string;
  eligible: boolean;
  eligibilityReason: string;
  seller: CaseInput['seller'];
  buyer: CaseInput['buyer'];
  invoices: (DocInvoice & {
    accepted: string;
    acceptedAssumed: boolean;
    msmeDue: string;
    balance: Paise;
    interest: Paise;
    daysLate: number;
  })[];
  totals: { balance: Paise; interest: Paise; interestNote: string };
  reminders: { date: string; stage: string; channel: string }[];
  payments: { date: string; amount: string; method: string; reference: string }[];
  disputes: CaseInput['disputes'];
  checklist: { item: string; have: boolean | null }[];
}

export function buildCaseModel(i: CaseInput): CaseModel {
  const elig = msmeEligibility(i.seller);
  const invoices = i.invoices.map((inv) => {
    const accepted = inv.accepted_on ?? inv.issue_date;
    const due = msmeDueDate(accepted, i.buyer.credit_days, i.buyer.has_written_agreement);
    const balance = paise(
      Math.max(
        inv.total_paise - inv.paid_paise - (inv.credited_paise ?? 0) - (inv.tds_paise ?? 0),
        0,
      ),
    );
    const interest = elig.applies
      ? msmedInterest({ principal: balance, dueDate: due, asOf: i.today }).interest_paise
      : paise(0);
    return {
      ...inv,
      accepted: prettyDate(accepted),
      acceptedAssumed: !inv.accepted_on,
      msmeDue: prettyDate(due),
      balance,
      interest,
      daysLate: Math.max(0, Math.round((Date.parse(i.today) - Date.parse(due)) / 86_400_000)),
    };
  });
  const balance = paise(invoices.reduce((s, x) => s + x.balance, 0));
  const interest = paise(invoices.reduce((s, x) => s + x.interest, 0));
  return {
    banner:
      'Prepared for your own use. It is not filed anywhere and has not been sent to the buyer.',
    disclaimer: GENERAL_INFO_LINE,
    eligible: elig.applies,
    eligibilityReason: elig.reason,
    seller: i.seller,
    buyer: i.buyer,
    invoices,
    totals: { balance, interest, interestNote: INTEREST_NOTE },
    reminders: i.reminders.map((r) => ({
      date: prettyDate(r.sent_at.slice(0, 10)),
      stage: STAGE_LABEL[r.stage] ?? r.stage,
      channel: r.channel,
    })),
    payments: i.payments.map((p) => ({
      date: prettyDate(p.received_on),
      amount: formatINR(paise(p.amount_paise)),
      method: p.method,
      reference: p.reference ?? '—',
    })),
    disputes: i.disputes,
    checklist: [
      { item: 'Udyam registration number and certificate', have: Boolean(i.seller.udyam_number) },
      {
        item: 'Buyer name, address, GSTIN or PAN, phone and email',
        have: Boolean(i.buyer.name && i.buyer.address),
      },
      { item: 'Invoices for each unpaid amount', have: i.invoices.length > 0 },
      {
        item: 'Proof of delivery or acceptance (challan, e-way bill, signed copy, email) for each invoice',
        have: null,
      },
      {
        item: 'Purchase order or written agreement showing the agreed payment days',
        have: i.buyer.has_written_agreement || null,
      },
      { item: 'Statement of account showing payments received', have: true },
      { item: 'Copies of reminders and replies from the buyer', have: i.reminders.length > 0 },
      { item: 'Your bank details', have: Boolean(i.seller.bank_account_number) },
      { item: 'Amount claimed, with interest calculated under Section 16', have: true },
    ],
  };
}

export function CaseDocument({ model: m }: { model: CaseModel }) {
  const { t } = useTranslation();
  return (
    <article className="doc-page" aria-label={t('Case pack')}>
      <header className="doc-head">
        <h1 className="doc-title">
          {t('Case pack:')} {m.buyer.name}
        </h1>
        <p className="doc-sub">
          <strong>{tr(m.banner)}</strong>
        </p>
        <p className="doc-sub">
          {t(
            'Information for preparing a reference on the MSME Samadhaan portal (samadhaan.msme.gov.in). {{disclaimer}}',
            { disclaimer: tr(m.disclaimer) },
          )}
        </p>
      </header>

      <section className="doc-grid">
        <div>
          <h2>{t('Supplier')}</h2>
          <p>
            <strong>{m.seller.name}</strong>
            <br />
            {m.seller.address}
            <br />
            {t('Udyam:')} {m.seller.udyam_number ?? t('not recorded')}
            <br />
            {t('Size:')} {m.seller.enterprise_size ? tr(m.seller.enterprise_size) : '—'}{' '}
            {t('· Activity:')} {m.seller.activity ? tr(m.seller.activity) : '—'}
            <br />
            {m.eligible
              ? t('Appears eligible')
              : t('May not be eligible: {{eligibilityReason}}', {
                  eligibilityReason: m.eligibilityReason,
                })}
          </p>
        </div>
        <div>
          <h2>{t('Buyer')}</h2>
          <p>
            <strong>{m.buyer.name}</strong>
            <br />
            {m.buyer.address}
            <br />
            {t('GSTIN:')} {m.buyer.gstin ?? '—'} {t('· Type:')}{' '}
            {m.buyer.entity_type ? tr(m.buyer.entity_type) : '—'}
            <br />
            {t('Credit days: {{credit_days}} · Written agreement:', {
              credit_days: m.buyer.credit_days,
            })}{' '}
            {m.buyer.has_written_agreement ? t('yes') : t('no')}
          </p>
        </div>
      </section>

      <h2>{t('Invoices')}</h2>
      <table className="doc-table">
        <thead>
          <tr>
            <th>{t('Invoice')}</th>
            <th>{t('Date')}</th>
            <th>{t('Accepted')}</th>
            <th>{t('MSME due date')}</th>
            <th>{t('Amount')}</th>
            <th>{t('Paid')}</th>
            <th>{t('Balance')}</th>
            <th>{t('Interest')}</th>
          </tr>
        </thead>
        <tbody>
          {m.invoices.map((r) => (
            <tr key={r.id}>
              <td>{r.number}</td>
              <td>{prettyDate(r.issue_date)}</td>
              <td>
                {r.accepted}
                {r.acceptedAssumed ? t(' (assumed: invoice date)') : ''}
              </td>
              <td>{r.msmeDue}</td>
              <td>{formatINR(paise(r.total_paise))}</td>
              <td>{formatINR(paise(r.paid_paise))}</td>
              <td>{formatINR(r.balance)}</td>
              <td>{formatINR(r.interest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {t('Total balance:')} <strong>{formatINR(m.totals.balance)}</strong> {t('· Interest:')}{' '}
        <strong>{formatINR(m.totals.interest)}</strong>
      </p>
      <p className="doc-fine">{tr(m.totals.interestNote)}</p>

      <h2>{t('Reminders sent')}</h2>
      {m.reminders.length ? (
        <table className="doc-table">
          <thead>
            <tr>
              <th>{t('Date')}</th>
              <th>{t('Step')}</th>
              <th>{t('Channel')}</th>
            </tr>
          </thead>
          <tbody>
            {m.reminders.map((r, k) => (
              <tr key={k}>
                <td>{r.date}</td>
                <td>{tr(r.stage)}</td>
                <td>{tr(r.channel)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>{t('None recorded.')}</p>
      )}

      <h2>{t('Payments received')}</h2>
      {m.payments.length ? (
        <table className="doc-table">
          <thead>
            <tr>
              <th>{t('Date')}</th>
              <th>{t('Amount')}</th>
              <th>{t('Method')}</th>
              <th>{t('Reference')}</th>
            </tr>
          </thead>
          <tbody>
            {m.payments.map((p, k) => (
              <tr key={k}>
                <td>{p.date}</td>
                <td>{p.amount}</td>
                <td>{tr(p.method)}</td>
                <td>{p.reference}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>{t('None recorded.')}</p>
      )}

      <h2>{t('Disputes')}</h2>
      {m.disputes.length ? (
        <ul>
          {m.disputes.map((d, k) => (
            <li key={k}>
              {t('{{status}}: {{reason}} (raised {{prettyDate}}', {
                status: d.status,
                reason: d.reason,
                prettyDate: prettyDate(d.raised_at.slice(0, 10)),
              })}
              {d.resolution_note
                ? t(', {{resolution_note}}', { resolution_note: d.resolution_note })
                : ''}
              {t(')')}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t('None recorded.')}</p>
      )}

      <h2>{t('What MSME Samadhaan generally asks for')}</h2>
      <p className="doc-fine">
        {t(
          'Requirements can change; check the portal. Items marked "to collect" are not in Receivia.',
        )}
      </p>
      <ul>
        {m.checklist.map((c) => (
          <li key={tr(c.item)}>
            {c.have === true ? '[ready]' : c.have === false ? '[missing]' : t('[to collect]')}{' '}
            {tr(c.item)}
          </li>
        ))}
      </ul>
    </article>
  );
}
