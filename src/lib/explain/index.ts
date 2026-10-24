import { addDays, daysBetween, type ISODate } from '@/lib/dates';
import { calcInvoice, calcLine, type InvoiceInput, type LineInput } from '@/lib/gst';
import { LEGAL_CONFIG, msmeDueDate, msmedInterest } from '@/lib/legal';
import { formatINR, paise } from '@/lib/money';
import {
  FORECAST_CONFIG,
  firstShortfall,
  type ChaseItem,
  type CustomerDelay,
  type Forecast,
  type GapPlan,
  type Grade,
  type Quantiles,
  type WeekBand,
} from '@/lib/forecast';

export interface ExplainSource {
  label: string;
  href: string;
}
export interface ExplainInput {
  label: string;
  value: string;
}
export interface Explanation {
  /** The raw figure (paise, days, a date, or a score) exactly as the screen shows it. */
  value: number | string;
  /** The figure as displayed. */
  display: string;
  title: string;
  formula: string;
  inputs: ExplainInput[];
  /** Rows the figure was computed from (links into the app). */
  sources: ExplainSource[];
  /** Legal reference, or null when none applies. */
  law: string | null;
}

const inr = (n: number) => formatINR(paise(Math.round(n)));
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const round1 = (n: number) => String(Math.round(n * 10) / 10);
const make = (
  e: Omit<Explanation, 'sources' | 'law' | 'display'> &
    Partial<Pick<Explanation, 'sources' | 'law' | 'display'>>,
): Explanation => ({
  sources: [],
  law: null,
  display: typeof e.value === 'number' ? String(e.value) : e.value,
  ...e,
});

export const OFFICIAL = {
  cgst: 'https://cbic-gst.gov.in',
  incomeTax: 'https://incometaxindia.gov.in',
  rbi: 'https://www.rbi.org.in',
  samadhaan: 'https://samadhaan.msme.gov.in',
} as const;

/** Invoice grand total: sum of per-line taxable + tax, then round-off to the nearest rupee. */
export function explainInvoiceTotal(input: InvoiceInput, sources: ExplainSource[] = []) {
  const r = calcInvoice(input);
  return make({
    value: r.grandTotal,
    display: formatINR(r.grandTotal),
    title: 'Invoice total',
    formula:
      'Add each line taxable value and its tax (each line tax rounded to the paisa), then round the sum to the nearest rupee. Total = taxable + tax + round-off.',
    inputs: [
      { label: 'Taxable value', value: formatINR(r.taxable) },
      ...(r.intraState
        ? [
            { label: 'CGST', value: formatINR(r.cgst) },
            { label: 'SGST', value: formatINR(r.sgst) },
          ]
        : [{ label: 'IGST', value: formatINR(r.igst) }]),
      { label: 'Subtotal', value: formatINR(r.subtotal) },
      { label: 'Round-off', value: formatINR(r.roundOff) },
    ],
    sources,
    law: 'CGST Act s.15 (value of supply) and s.9; IGST Act s.5. Verify rates on cbic-gst.gov.in.',
  });
}

/** One invoice line: taxable = qty x rate - discount; tax at the line rate. */
export function explainGstLine(
  line: LineInput,
  intraState: boolean,
  collectsTax = true,
  sources: ExplainSource[] = [],
) {
  const r = calcLine(line, intraState, collectsTax);
  const tax = r.cgst + r.sgst + r.igst;
  return make({
    value: r.total,
    display: formatINR(r.total),
    title: 'Line amount with GST',
    formula: intraState
      ? 'Taxable = quantity x rate - discount. CGST and SGST are each half the rate on the taxable value, each rounded to the paisa on its own.'
      : 'Taxable = quantity x rate - discount. IGST is the full rate on the taxable value, rounded to the paisa.',
    inputs: [
      { label: 'Quantity', value: String(line.qty) },
      { label: 'Rate', value: formatINR(line.rate) },
      { label: 'Discount', value: formatINR(line.discount ?? paise(0)) },
      { label: 'GST rate', value: `${line.gstRate}%` },
      { label: 'Taxable value', value: formatINR(r.taxable) },
      { label: 'Tax', value: formatINR(paise(tax)) },
    ],
    sources,
    law: intraState
      ? 'CGST Act s.9 and SGST Act s.9 (intra-state supply).'
      : 'IGST Act s.5 (inter-state supply).',
  });
}

export function explainDaysOverdue(due: ISODate, today: ISODate, sources: ExplainSource[] = []) {
  const d = Math.max(0, daysBetween(due, today));
  return make({
    value: d,
    display: `${d} day${d === 1 ? '' : 's'}`,
    title: 'Days overdue',
    formula: 'Days overdue = today - due date, never below zero. Dates are in IST.',
    inputs: [
      { label: 'Due date', value: due },
      { label: 'Today', value: today },
    ],
    sources,
  });
}

export function explainMsmeDue(
  accepted: ISODate,
  agreedDays: number,
  hasWrittenAgreement: boolean,
  sources: ExplainSource[] = [],
) {
  const due = msmeDueDate(accepted, agreedDays, hasWrittenAgreement);
  return make({
    value: due,
    title: 'MSME due date',
    formula: hasWrittenAgreement
      ? `Acceptance date + the agreed credit days, capped at ${LEGAL_CONFIG.msmeMaxAgreedDays} days.`
      : `With no written agreement: acceptance date + ${LEGAL_CONFIG.msmeDefaultDays} days.`,
    inputs: [
      { label: 'Acceptance (or invoice) date', value: accepted },
      { label: 'Agreed credit days', value: String(agreedDays) },
      { label: 'Written agreement', value: hasWrittenAgreement ? 'yes' : 'no' },
      { label: 'Days counted', value: String(daysBetween(accepted, due)) },
    ],
    sources,
    law: 'MSMED Act, 2006 s.15. General information, not legal or tax advice.',
  });
}

export function explainInterest(
  args: { principal: number; dueDate: ISODate; asOf: ISODate; bankRatePct?: number },
  sources: ExplainSource[] = [],
) {
  const i = msmedInterest({ ...args, principal: paise(args.principal) });
  return make({
    value: i.interest_paise,
    display: formatINR(i.interest_paise),
    title: 'Interest on the overdue amount',
    formula:
      'Rate = 3 x RBI bank rate a year. Interest is added to the base at the end of each completed month (monthly rests); the part-month at the end is simple on that base. Each step is rounded to the paisa.',
    inputs: [
      { label: 'Principal', value: inr(args.principal) },
      { label: 'Due date', value: args.dueDate },
      { label: 'As of', value: args.asOf },
      {
        label: 'RBI bank rate',
        value: `${args.bankRatePct ?? LEGAL_CONFIG.rbiBankRatePct}% (check rbi.org.in)`,
      },
      { label: 'Rate applied', value: `${i.annual_rate_pct}% a year` },
      { label: 'Days / completed months', value: `${i.days} / ${i.months}` },
    ],
    sources,
    law: 'MSMED Act, 2006 s.16. General information, not legal or tax advice.',
  });
}

export function explainItc180(issueDate: ISODate, today: ISODate, sources: ExplainSource[] = []) {
  const d = addDays(issueDate, LEGAL_CONFIG.itcDays);
  return make({
    value: d,
    title: '180-day input tax credit date',
    formula: `Invoice date + ${LEGAL_CONFIG.itcDays} days. A buyer who has not paid by then may have to reverse the credit on the unpaid GST.`,
    inputs: [
      { label: 'Invoice date', value: issueDate },
      { label: 'Days left from today', value: String(daysBetween(today, d)) },
    ],
    sources,
    law: 'CGST Act s.16(2) second proviso with CGST Rules r.37. General information, not legal or tax advice.',
  });
}

const BAND_FIELD = {
  closing: 'Closing balance',
  inflow: 'Collections',
  outflow: 'Payments out',
} as const;

/** One of P10 / P50 / P90 of a forecast week. */
export function explainForecastQuantile(
  f: Forecast,
  band: WeekBand,
  field: keyof typeof BAND_FIELD,
  q: keyof Quantiles,
  sources: ExplainSource[] = [],
) {
  const v = band[field][q];
  const n = q === 'p10' ? 10 : q === 'p50' ? 50 : 90;
  return make({
    value: v,
    display: inr(v),
    title: `${BAND_FIELD[field]}, P${n}, week ${band.week}`,
    formula: `The forecast is run ${f.runs} times. Each run draws every open invoice payment date from the customer's delay history. P${n} is the value that ${n}% of the runs came in at or below, for week ${band.week} (${band.start} to ${band.end}).`,
    inputs: [
      { label: 'Runs', value: String(f.runs) },
      { label: 'Safety buffer', value: formatINR(paise(f.bufferPaise)) },
      { label: 'Opening, P50', value: inr(band.opening.p50) },
      { label: 'Chance below buffer', value: pct(band.probBelowBuffer) },
    ],
    sources,
  });
}

export function explainShortfall(f: Forecast, sources: ExplainSource[] = []) {
  const sf = firstShortfall(f);
  if (!sf) return null;
  const gap = f.bufferPaise - sf.closing.p50;
  return make({
    value: gap,
    display: inr(gap),
    title: `Shortfall in week ${sf.week}`,
    formula:
      'Shortfall = safety buffer - median (P50) closing balance of the first week whose median closing is below the buffer.',
    inputs: [
      { label: 'Safety buffer', value: formatINR(paise(f.bufferPaise)) },
      { label: `Week ${sf.week} closing, P50`, value: inr(sf.closing.p50) },
      {
        label: `Week ${sf.week} closing, P10 to P90`,
        value: `${inr(sf.closing.p10)} to ${inr(sf.closing.p90)}`,
      },
    ],
    sources,
  });
}

export function explainChaseScore(item: ChaseItem, grade: Grade, sources: ExplainSource[] = []) {
  const w = FORECAST_CONFIG.gradeWeight[grade] ?? 1;
  const score = item.expectedPaise * (1 + Math.min(item.daysOverdue, 120) / 120) * w;
  return make({
    value: score,
    display: String(Math.round(score)),
    title: 'Chase score',
    formula: `Score = expected rupees by the end of week ${item.targetWeek} if chased now (balance x chance of payment) x (1 + days overdue / 120, days capped at 120) x reliability weight (A 1, B 0.85, C 0.65). Disputed invoices score 0.`,
    inputs: [
      { label: 'Balance', value: inr(item.balancePaise) },
      { label: 'Chance paid in time if chased', value: pct(item.probChased) },
      { label: 'Chance paid in time if not', value: pct(item.probBase) },
      { label: 'Expected amount', value: inr(item.expectedPaise) },
      { label: 'Days overdue', value: String(item.daysOverdue) },
      { label: `Grade ${grade} weight`, value: String(w) },
    ],
    sources,
  });
}

export function explainSolverCost(plan: GapPlan, sources: ExplainSource[] = []) {
  return make({
    value: plan.totalCostPaise,
    display: inr(plan.totalCostPaise),
    title: `Cost of the week ${plan.week} plan`,
    formula:
      'Cost = sum of the cost of each chosen step (chasing is free; discount = 2% of the cash it brings; TReDS = rate x days / 365; deferring a bill = 1.5% a month). Steps are picked cheapest per rupee covered until the gap is covered. These rates are assumptions to check with your bank.',
    inputs: [
      { label: 'Gap to cover', value: inr(plan.gapPaise) },
      { label: 'Covered by the plan', value: inr(plan.coveredPaise) },
      ...plan.steps.map((s) => ({
        label: s.sentence,
        value: `covers ${inr(s.cover)}, costs ${inr(s.cost)}`,
      })),
    ],
    sources,
  });
}

/** 0 to 100: 100 for a customer who pays on the due date, falling to 0 at 60 days late (shrunk P80). */
export function explainPayability(d: CustomerDelay, sources: ExplainSource[] = []) {
  const score = Math.max(0, Math.min(100, Math.round(100 - (d.p80 * 100) / 60)));
  return make({
    value: score,
    display: `${score} / 100`,
    title: 'Payability score',
    formula: `Score = 100 - (P80 days late x 100 / 60), kept between 0 and 100. The P80 blends the customer's own history with all customers using weight n / (n + ${FORECAST_CONFIG.shrinkK}).`,
    inputs: [
      { label: 'Paid invoices (n)', value: String(d.n) },
      { label: 'Weight on own history', value: pct(d.weight) },
      { label: 'P80 days late (shrunk)', value: round1(d.p80) },
      { label: 'Grade', value: d.grade },
    ],
    sources,
  });
}

/** Suggested limit = average monthly billing x (credit days + P80 days late) / 30, rounded down to Rs 1,000. */
export function explainCreditLimit(
  args: { monthlyBilledPaise: number; creditDays: number; p80Late: number },
  sources: ExplainSource[] = [],
) {
  const months = (args.creditDays + Math.max(0, args.p80Late)) / 30;
  const limit = Math.floor((args.monthlyBilledPaise * months) / 100_000) * 100_000;
  return make({
    value: limit,
    display: inr(limit),
    title: 'Suggested credit limit',
    formula:
      'Limit = average monthly billing x (credit days + P80 days late) / 30, rounded down to Rs 1,000. It is roughly the most this customer will owe at one time if they keep paying as they have.',
    inputs: [
      { label: 'Average monthly billing', value: inr(args.monthlyBilledPaise) },
      { label: 'Credit days', value: String(args.creditDays) },
      { label: 'P80 days late', value: round1(args.p80Late) },
    ],
    sources,
  });
}

/** The total stored on an issued invoice: taxable + tax + round-off, as saved when it was issued. */
export function explainStoredInvoiceTotal(
  row: {
    taxable_paise: number;
    cgst_paise: number;
    sgst_paise: number;
    igst_paise: number;
    round_off_paise: number;
    total_paise: number;
  },
  sources: ExplainSource[] = [],
) {
  const intra = row.cgst_paise + row.sgst_paise > 0;
  return make({
    value: row.total_paise,
    display: formatINR(paise(row.total_paise)),
    title: 'Invoice total',
    formula:
      'Total = taxable value + GST + round-off to the nearest rupee. Each line tax is rounded to the paisa before the lines are added.',
    inputs: [
      { label: 'Taxable value', value: inr(row.taxable_paise) },
      ...(intra
        ? [
            { label: 'CGST', value: inr(row.cgst_paise) },
            { label: 'SGST', value: inr(row.sgst_paise) },
          ]
        : [{ label: 'IGST', value: inr(row.igst_paise) }]),
      { label: 'Round-off', value: inr(row.round_off_paise) },
    ],
    sources,
    law: 'CGST Act s.15 and s.9; IGST Act s.5. Verify rates on cbic-gst.gov.in.',
  });
}
