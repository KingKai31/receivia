import { GENERAL_INFO_LINE } from '@/lib/legal';

export const DISCLAIMER = GENERAL_INFO_LINE;

export interface LawEntry {
  id: string;
  name: string;
  /** Who it may apply to, in hedged words. */
  eligibility: string;
  /** What it says in one or two hedged sentences. */
  summary: string;
  /** Where in the app it appears. */
  where: string;
  links: { label: string; href: string }[];
}

/** Official sites. Links go to the department home pages: find the section there and verify before relying on it. */
export const SITES = {
  cbic: { label: 'cbic-gst.gov.in (CGST Act and Rules)', href: 'https://cbic-gst.gov.in' },
  it: { label: 'incometaxindia.gov.in (Income-tax Act)', href: 'https://incometaxindia.gov.in' },
  msme: { label: 'msme.gov.in (MSMED Act)', href: 'https://msme.gov.in' },
  samadhaan: { label: 'samadhaan.msme.gov.in', href: 'https://samadhaan.msme.gov.in' },
  rbi: { label: 'rbi.org.in (bank rate)', href: 'https://www.rbi.org.in' },
  mca: { label: 'mca.gov.in (MSME Form I)', href: 'https://www.mca.gov.in' },
  indiacode: { label: 'indiacode.nic.in (Acts)', href: 'https://www.indiacode.nic.in' },
} as const;

export const TOC: [string, string][] = [
  ['gst', 'GST engine'],
  ['laws', 'Laws we apply'],
  ['forecast', 'Forecast'],
  ['chase', 'Chase score and gap solver'],
  ['agent', 'Agent workflow'],
  ['security', 'Security'],
  ['real', 'Real vs simulated'],
];

export const LAWS: LawEntry[] = [
  {
    id: 'itc180',
    name: 'CGST Act s.16(2) second proviso with Rule 37: 180-day input tax credit',
    eligibility:
      'A buyer with a GSTIN, on a tax invoice that is not a reverse-charge supply, with an unpaid balance.',
    summary:
      'A buyer generally needs to pay a supplier within 180 days of the invoice date; otherwise it may have to reverse the input tax credit on the unpaid GST. Receivia adds that date to reminders from the firm stage onward.',
    where: 'Invoice detail (180-day ITC date), reminder letters, Payment Demand Letter.',
    links: [SITES.cbic, SITES.indiacode],
  },
  {
    id: '43bh',
    name: 'Income-tax Act s.43B(h) with MSMED Act s.15',
    eligibility:
      'Seller has an Udyam number, is micro or small, and does manufacturing or services (traders generally fall outside). Buyer is not an individual consumer, not government, and not taxed on a presumptive basis (soft wording when that is unknown).',
    summary:
      'A buyer’s deduction for a purchase from a micro or small enterprise may be allowed only in the year of actual payment when payment goes beyond the MSMED due date. Due date: the agreed date, at most 45 days from acceptance with a written agreement, otherwise 15 days.',
    where: 'Buyer Compliance Lens line on reminders, MSME due date on the invoice.',
    links: [SITES.it, SITES.msme],
  },
  {
    id: 'interest',
    name: 'MSMED Act s.16: interest on delayed payment',
    eligibility: 'The same eligible micro or small supplier, for amounts past the s.15 due date.',
    summary:
      'Interest may run at three times the RBI bank rate, compounded with monthly rests, from the due date. The bank rate is kept in one config value; check rbi.org.in for the current figure.',
    where: 'Payment Demand Letter and the interest figure on the case pack.',
    links: [SITES.msme, SITES.rbi],
  },
  {
    id: 'form1',
    name: 'MSME Form I (Companies Act, 2013 s.405 and the related order)',
    eligibility: 'Buyer is a company and owes an MSME supplier past the MSMED due date.',
    summary:
      'A company with such dues may have to report them in MSME Form I, which is generally filed half-yearly for amounts outstanding more than 45 days.',
    where: 'Buyer Compliance Lens line on reminders to company buyers.',
    links: [SITES.mca, SITES.samadhaan],
  },
  {
    id: 's34',
    name: 'CGST Act s.34: credit-note time limit',
    eligibility: 'Any supplier issuing a credit note against an invoice.',
    summary:
      'A credit note for an invoice generally has to be issued by 30 November after the end of that invoice’s financial year, or the date the annual return is filed if earlier. Receivia shows the outer date (30 November) and warns when it is near or past.',
    where: 'Credit note form and the inbox when a dispute is accepted as a credit note.',
    links: [SITES.cbic, SITES.indiacode],
  },
  {
    id: 'tds',
    name: 'TDS: 194C, 194J, 194H, 194Q and GST TDS (CGST Act s.51)',
    eligibility:
      'Buyers who deduct tax at source when paying. Which section applies depends on the nature of the payment and the buyer; thresholds (for example the 194Q purchase limit and the GST TDS payment limit) are not modelled.',
    summary:
      'When a payment arrives short, Receivia checks whether the shortfall matches a TDS rate on the taxable value within ₹1, and proposes it as TDS for a person to confirm. It never applies it on its own.',
    where: 'Payments (bank matching) and the TDS certificates page.',
    links: [SITES.it, SITES.cbic],
  },
];
