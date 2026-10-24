import { nextAction, type LadderInput } from '@/features/collect/ladder';
import { addDays } from '@/lib/dates';
import {
  buildDelayModels,
  delaySamples,
  simulate,
  type CustomerInfo,
  type HistInvoice,
  type OpenInvoice,
} from '@/lib/forecast';
import { calcInvoice, invoiceHeading } from '@/lib/gst';
import { validateGstin } from '@/lib/gstin';
import {
  suggestOne,
  type BankLine,
  type MatchCustomer,
  type OpenInvoice as BankInvoice,
} from '@/lib/match';
import { amountInWordsFor, amountInWordsIndian, formatINR, paise } from '@/lib/money';

export interface TrustCase {
  group: string;
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}

const cases: (() => TrustCase)[] = [];
function add(group: string, name: string, expected: string, run: () => string) {
  cases.push(() => {
    let actual: string;
    try {
      actual = run();
    } catch (e) {
      actual = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
    return { group, name, expected, actual, pass: actual === expected };
  });
}

const rupees = (n: number) => formatINR(paise(n));

// ---- GST ------------------------------------------------------------------
const line = (qty: number, rate: number, gstRate: number, discount = 0) => ({
  qty,
  rate: paise(rate),
  gstRate,
  discount: paise(discount),
});
const gst = (r: ReturnType<typeof calcInvoice>) =>
  `taxable ${rupees(r.taxable)}, CGST ${rupees(r.cgst)}, SGST ${rupees(r.sgst)}, IGST ${rupees(r.igst)}, total ${rupees(r.grandTotal)}`;

add(
  'GST',
  'Same state, 18% on ₹1,000.00: CGST and SGST each take half',
  'taxable ₹1,000.00, CGST ₹90.00, SGST ₹90.00, IGST ₹0.00, total ₹1,180.00',
  () =>
    gst(
      calcInvoice({
        lines: [line(1, 100000, 18)],
        supplierStateCode: '27',
        placeOfSupply: '27',
        registrationType: 'regular',
      }),
    ),
);
add(
  'GST',
  'Other state, 18% on ₹1,000.00: IGST only',
  'taxable ₹1,000.00, CGST ₹0.00, SGST ₹0.00, IGST ₹180.00, total ₹1,180.00',
  () =>
    gst(
      calcInvoice({
        lines: [line(1, 100000, 18)],
        supplierStateCode: '27',
        placeOfSupply: '29',
        registrationType: 'regular',
      }),
    ),
);
add(
  'GST',
  'A discount comes off before tax: 2 × ₹500.00 less ₹100.00 at 5%',
  'taxable ₹900.00, CGST ₹22.50, SGST ₹22.50, IGST ₹0.00, total ₹945.00',
  () =>
    gst(
      calcInvoice({
        lines: [line(2, 50000, 5, 10000)],
        supplierStateCode: '27',
        placeOfSupply: '27',
        registrationType: 'regular',
      }),
    ),
);
add(
  'GST',
  'Tax rounds to the paisa per line and the total rounds to a whole rupee',
  'CGST ₹2.50, SGST ₹2.50, round-off ₹0.01, total ₹105.00',
  () => {
    const r = calcInvoice({
      lines: [line(3, 3333, 5)],
      supplierStateCode: '27',
      placeOfSupply: '27',
      registrationType: 'regular',
    });
    return `CGST ${rupees(r.cgst)}, SGST ${rupees(r.sgst)}, round-off ${rupees(r.roundOff)}, total ${rupees(r.grandTotal)}`;
  },
);
add(
  'GST',
  'A composition supplier collects no tax and issues a Bill of Supply',
  'Bill of Supply, tax ₹0.00, total ₹1,000.00',
  () => {
    const r = calcInvoice({
      lines: [line(1, 100000, 18)],
      supplierStateCode: '27',
      placeOfSupply: '27',
      registrationType: 'composition',
    });
    return `${invoiceHeading('composition')}, tax ${rupees(r.totalTax)}, total ${rupees(r.grandTotal)}`;
  },
);

// ---- GSTIN ----------------------------------------------------------------
const VALID_GSTIN = '27AAPFU0939F1ZV';
add('GSTIN', 'A real-format GSTIN with the right check character', 'valid', () =>
  validateGstin(VALID_GSTIN).valid ? 'valid' : 'invalid',
);
add('GSTIN', 'One changed character fails the checksum', 'invalid: CHECKSUM', () => {
  const r = validateGstin('27AAPFU0939F1ZW');
  return r.valid ? 'valid' : `invalid: ${r.reason}`;
});
add('GSTIN', 'A short number is rejected for length', 'invalid: LENGTH', () => {
  const r = validateGstin('27AAPFU0939F1Z');
  return r.valid ? 'valid' : `invalid: ${r.reason}`;
});

// ---- Amount in words ------------------------------------------------------
add('Amount in words', '₹1,180.00', 'Rupees One Thousand One Hundred Eighty Only', () =>
  amountInWordsIndian(paise(118000)),
);
add(
  'Amount in words',
  '₹1,23,45,678.50 uses crore, lakh and thousand',
  'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Fifty Paise Only',
  () => amountInWordsIndian(paise(1_234_567_850)),
);
add('Amount in words', '₹11,800.00 in Hindi', 'ग्यारह हज़ार आठ सौ रुपये मात्र', () =>
  amountInWordsFor(paise(1_180_000), 'hi'),
);
add('Amount in words', '₹11,800.00 in Marathi', 'अकरा हजार आठशे रुपये फक्त', () =>
  amountInWordsFor(paise(1_180_000), 'mr'),
);

// ---- Reminder ladder ------------------------------------------------------
const DUE = '2026-06-01';
const ladderInput = (over: Partial<LadderInput>): LadderInput => ({
  invoice: { due_date: DUE, total_paise: 100000, paid_paise: 0, status: 'issued' },
  tier: 'standard',
  today: DUE,
  sentStages: [],
  hasOpenDispute: false,
  ...over,
});
const stageOn = (day: number, over: Partial<LadderInput> = {}) => {
  const d = nextAction(ladderInput({ today: addDays(DUE, day), ...over }));
  return d.action === 'send' || d.action === 'needs_approval'
    ? `${d.action}: ${d.stage}`
    : d.action;
};
add(
  'Ladder',
  'Standard customer, days from the due date: -3, 0, 7, 15, 30, 45',
  'send: pre_due | send: due_today | send: overdue_firm | send: final | send: demand_letter | send: next_steps',
  () => [-3, 0, 7, 15, 30, 45].map((d) => stageOn(d)).join(' | '),
);
add('Ladder', 'Nothing is sent five days before the due date', 'none', () => stageOn(-5));
add('Ladder', 'An open dispute pauses reminders', 'paused', () =>
  stageOn(20, { hasOpenDispute: true }),
);
add(
  'Ladder',
  'A key customer needs the owner to approve the final reminder',
  'needs_approval: final',
  () => stageOn(15, { tier: 'key' }),
);
add('Ladder', 'A stage already sent is not sent again', 'none', () =>
  stageOn(0, { sentStages: ['due_today'] }),
);

// ---- Matching -------------------------------------------------------------
const customers: MatchCustomer[] = [
  { id: 'c1', name: 'Acme Traders Pvt Ltd', entityType: 'company' },
];
const invoices: BankInvoice[] = [
  {
    id: 'i1',
    number: 'INV/26-27/0001',
    customerId: 'c1',
    balancePaise: 1_180_000,
    taxablePaise: 1_000_000,
    issueDate: '2026-09-01',
    dueDate: '2026-10-01',
  },
];
const bank = (description: string, credit: number, debit = 0): BankLine => ({
  date: '2026-10-05',
  description,
  creditPaise: paise(credit),
  debitPaise: paise(debit),
  reference: '',
});
const matchKind = (l: BankLine) => {
  const s = suggestOne(l, invoices, customers);
  return `${s.kind}${s.tds ? ` ${s.tds.section}` : ''}`;
};
add('Matching', 'Deposit equals the invoice and names it', 'exact', () =>
  matchKind(bank('NEFT INV/26-27/0001 ACME TRADERS', 1_180_000)),
);
add(
  'Matching',
  'Deposit is ₹200 short, which is 2% of the taxable value: TDS under 194C',
  'tds_short 194C',
  () => matchKind(bank('NEFT INV/26-27/0001 ACME TRADERS', 1_160_000)),
);
add(
  'Matching',
  'Deposit is less than the invoice and not explained by TDS: part payment',
  'part',
  () => matchKind(bank('NEFT INV/26-27/0001 ACME TRADERS', 500_000)),
);
add('Matching', 'Deposit is more than the invoice: overpayment', 'overpayment', () =>
  matchKind(bank('NEFT INV/26-27/0001 ACME TRADERS', 1_200_000)),
);
add('Matching', 'Money going out is never matched to an invoice', 'debit', () =>
  matchKind(bank('RENT PAID', 0, 500_000)),
);
add('Matching', 'A deposit that matches nothing is flagged unknown', 'unknown', () =>
  matchKind(bank('CASH DEPOSIT', 123_456)),
);

// ---- Forecast invariants --------------------------------------------------
const TODAY = '2026-10-26';
const histInv = (customerId: string, i: number, late: number): HistInvoice => {
  const due = addDays('2026-01-01', i * 10);
  return {
    id: `${customerId}-h${i}`,
    customerId,
    issueDate: addDays(due, -30),
    dueDate: due,
    totalPaise: 100000,
    events: [{ date: addDays(due, late), amountPaise: 100000 }],
  };
};
function forecastInput() {
  const history = [
    ...Array.from({ length: 10 }, (_, i) => histInv('a', i, 5)),
    ...Array.from({ length: 10 }, (_, i) => histInv('b', i, 25)),
  ];
  const customersInfo: CustomerInfo[] = [
    { id: 'a', name: 'A', entityType: 'firm', creditDays: 30 },
    { id: 'b', name: 'B', entityType: 'firm', creditDays: 30 },
  ];
  const open: OpenInvoice[] = [
    { id: '1', customerId: 'a', dueDate: addDays(TODAY, -5), balancePaise: 400000 },
    { id: '2', customerId: 'b', dueDate: addDays(TODAY, 12), balancePaise: 650000 },
  ];
  return {
    today: TODAY,
    openingBalancePaise: 500000,
    bufferPaise: 100000,
    invoices: open,
    customers: customersInfo,
    models: buildDelayModels(delaySamples(history)),
    occurrences: [
      {
        expenseId: 'e1',
        name: 'Rent',
        date: addDays(TODAY, 9),
        amountPaise: 300000,
        deferrable: false,
      },
      {
        expenseId: 'e2',
        name: 'Salaries',
        date: addDays(TODAY, 40),
        amountPaise: 600000,
        deferrable: false,
      },
    ],
    runs: 200,
  };
}
add(
  'Forecast',
  'In every run each week closes at opening + money in - money out',
  '0 breaks in 200 runs × 13 weeks',
  () => {
    const f = simulate(forecastInput());
    let bad = 0;
    for (let r = 0; r < f.runs; r++)
      for (let w = 0; w < 13; w++)
        if (
          f.paths.closing[r]![w] !==
          f.paths.opening[r]![w]! + f.paths.inflow[r]![w]! - f.paths.outflow[r]![w]!
        )
          bad++;
    return `${bad} breaks in ${f.runs} runs × 13 weeks`;
  },
);
add(
  'Forecast',
  'Each week opens where the previous week closed',
  '0 breaks in 200 runs × 12 joins',
  () => {
    const f = simulate(forecastInput());
    let bad = 0;
    for (let r = 0; r < f.runs; r++)
      for (let w = 0; w < 12; w++) if (f.paths.opening[r]![w + 1] !== f.paths.closing[r]![w]) bad++;
    return `${bad} breaks in ${f.runs} runs × 12 joins`;
  },
);
add('Forecast', 'The same inputs always give the same numbers', 'identical', () => {
  const a = simulate(forecastInput());
  const b = simulate(forecastInput());
  return JSON.stringify(a.weeks) === JSON.stringify(b.weeks) ? 'identical' : 'different';
});
add(
  'Forecast',
  'The 10th, 50th and 90th percentile lines never cross',
  'ordered in all 13 weeks',
  () => {
    const f = simulate(forecastInput());
    const ok = f.weeks.every(
      (w) => w.closing.p10 <= w.closing.p50 && w.closing.p50 <= w.closing.p90,
    );
    return ok ? 'ordered in all 13 weeks' : 'crossed';
  },
);
add(
  'Forecast',
  'Known bills leave the bank in the week they fall due',
  '₹3,000.00 out in week 2',
  () => {
    const f = simulate(forecastInput());
    return `${rupees(f.weeks[1]!.outflow.p50)} out in week 2`;
  },
);

export function runTrustCases(): TrustCase[] {
  return cases.map((c) => c());
}
