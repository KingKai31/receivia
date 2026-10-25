import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '@/lib/dates';
import { calcInvoice, calcLine } from '@/lib/gst';
import { msmeDueDate, msmedInterest } from '@/lib/legal';
import { formatINR, paise } from '@/lib/money';
import {
  buildDelayModels,
  chaseScores,
  delaySamples,
  firstShortfall,
  modelFor,
  simulate,
  solveGap,
  type CustomerInfo,
  type HistInvoice,
  type OpenInvoice,
  type Occurrence,
} from '@/lib/forecast';
import {
  explainChaseScore,
  explainCreditLimit,
  explainDaysOverdue,
  explainForecastQuantile,
  explainGstLine,
  explainInterest,
  explainInvoiceTotal,
  explainItc180,
  explainMsmeDue,
  explainPayability,
  explainShortfall,
  explainSolverCost,
  explainStoredInvoiceTotal,
} from './index';

const TODAY = '2026-10-26';
const lines = [{ qty: 1, rate: paise(1_000_000), gstRate: 18 }];

function complete(e: { formula: string; inputs: unknown[]; title: string }) {
  expect(e.title.length).toBeGreaterThan(3);
  expect(e.formula.length).toBeGreaterThan(20);
  expect(e.inputs.length).toBeGreaterThan(0);
}

describe('GST explanations', () => {
  it('worked example Rs 10,000 at 18%: same state and other state', () => {
    const same = explainInvoiceTotal({
      lines,
      supplierStateCode: '27',
      placeOfSupply: '27',
      registrationType: 'regular',
    });
    expect(same.value).toBe(1_180_000);
    expect(same.inputs.map((i) => i.label)).toEqual(expect.arrayContaining(['CGST', 'SGST']));
    expect(same.inputs.find((i) => i.label === 'CGST')!.value).toBe(formatINR(paise(90_000)));
    const other = explainInvoiceTotal({
      lines,
      supplierStateCode: '27',
      placeOfSupply: '29',
      registrationType: 'regular',
    });
    expect(other.value).toBe(1_180_000);
    expect(other.inputs.find((i) => i.label === 'IGST')!.value).toBe(formatINR(paise(180_000)));
    complete(same);
  });
  it('invoice total equals calcInvoice, with round-off', () => {
    const input = {
      lines: [{ qty: 3, rate: paise(33_333), gstRate: 5 }],
      supplierStateCode: '27',
      placeOfSupply: '27',
      registrationType: 'regular' as const,
    };
    const e = explainInvoiceTotal(input);
    const r = calcInvoice(input);
    expect(e.value).toBe(r.grandTotal);
    expect(e.display).toBe(formatINR(r.grandTotal));
    expect(e.inputs.find((i) => i.label === 'Round-off')!.value).toBe(formatINR(r.roundOff));
  });
  it('line equals calcLine in both cases', () => {
    for (const intra of [true, false]) {
      const line = { qty: 2.5, rate: paise(12_345), discount: paise(100), gstRate: 12 };
      const l = { ...line, gstRate: 18 };
      const e = explainGstLine(l, intra);
      expect(e.value).toBe(calcLine(l, intra).total);
      expect(e.law).toMatch(intra ? /CGST/ : /IGST/);
    }
  });
  it('composition shows no tax', () => {
    const e = explainInvoiceTotal({
      lines,
      supplierStateCode: '27',
      placeOfSupply: '27',
      registrationType: 'composition',
    });
    expect(e.value).toBe(1_000_000);
  });
});

describe('legal explanations', () => {
  it('days overdue never below zero and matches daysBetween', () => {
    expect(explainDaysOverdue('2026-10-01', TODAY).value).toBe(daysBetween('2026-10-01', TODAY));
    expect(explainDaysOverdue('2026-12-01', TODAY).value).toBe(0);
  });
  it('MSME due date equals msmeDueDate (written cap 45, none 15)', () => {
    expect(explainMsmeDue('2026-09-01', 90, true).value).toBe(msmeDueDate('2026-09-01', 90, true));
    expect(explainMsmeDue('2026-09-01', 90, true).value).toBe('2026-10-16');
    expect(explainMsmeDue('2026-09-01', 30, false).value).toBe('2026-09-16');
    expect(explainMsmeDue('2026-09-01', 30, false).law).toMatch(/s\.15/);
  });
  it('interest equals msmedInterest and names s.16', () => {
    const a = { principal: 5_000_000, dueDate: '2026-06-01', asOf: TODAY };
    const e = explainInterest(a);
    const r = msmedInterest({ ...a, principal: paise(a.principal) });
    expect(e.value).toBe(r.interest_paise);
    expect(e.display).toBe(formatINR(r.interest_paise));
    expect(e.law).toMatch(/s\.16/);
    expect(e.inputs.map((i) => i.value)).toContain(`${r.annual_rate_pct}% a year`);
  });
  it('ITC date is invoice date + 180 days', () => {
    const e = explainItc180('2026-04-01', TODAY);
    expect(e.value).toBe(addDays('2026-04-01', 180));
    expect(e.law).toMatch(/16\(2\).*37/);
  });
  it('every legal explanation carries the general-information line where law is cited', () => {
    for (const e of [
      explainMsmeDue('2026-09-01', 30, true),
      explainInterest({ principal: 100_000, dueDate: '2026-06-01', asOf: TODAY }),
      explainItc180('2026-04-01', TODAY),
    ]) {
      expect(e.law).toMatch(/General information, not legal or tax advice\./);
    }
  });
});

const cust = (id: string, over: Partial<CustomerInfo> = {}): CustomerInfo => ({
  id,
  name: `Customer ${id}`,
  entityType: 'company',
  creditDays: 30,
  ...over,
});
const hist = (id: string, customerId: string, due: string, late: number): HistInvoice => ({
  id,
  customerId,
  issueDate: addDays(due, -30),
  dueDate: due,
  totalPaise: 100_000,
  events: [{ date: addDays(due, late), amountPaise: 100_000 }],
});
const history = Array.from({ length: 8 }, (_, i) =>
  hist(`h${i}`, 'a', addDays('2026-01-01', i * 10), 20),
);
const models = buildDelayModels(delaySamples(history));
const customers = [cust('a')];
const invoices: OpenInvoice[] = [
  { id: 'i1', number: 'N1', customerId: 'a', dueDate: addDays(TODAY, -5), balancePaise: 8_000_000 },
  { id: 'i2', number: 'N2', customerId: 'a', dueDate: addDays(TODAY, 10), balancePaise: 3_000_000 },
];
const bill: Occurrence[] = [
  {
    expenseId: 'e1',
    name: 'Steel',
    date: addDays(TODAY, 9),
    amountPaise: 6_000_000,
    deferrable: true,
  },
];
const f = simulate({
  today: TODAY,
  openingBalancePaise: 2_000_000,
  bufferPaise: 1_500_000,
  invoices,
  customers,
  models,
  occurrences: bill,
  runs: 200,
});

describe('forecast explanations', () => {
  it('P10/P50/P90 equal the band values', () => {
    for (const band of f.weeks) {
      for (const field of ['closing', 'inflow', 'outflow'] as const) {
        for (const q of ['p10', 'p50', 'p90'] as const) {
          const e = explainForecastQuantile(f, band, field, q);
          expect(e.value).toBe(band[field][q]);
          expect(e.display).toBe(formatINR(paise(Math.round(band[field][q]))));
        }
      }
    }
    complete(explainForecastQuantile(f, f.weeks[0]!, 'closing', 'p50'));
  });
  it('shortfall equals buffer minus P50 closing of the first short week; null when none', () => {
    const sf = firstShortfall(f);
    const e = explainShortfall(f)!;
    expect(sf).not.toBeNull();
    expect(e.value).toBe(f.bufferPaise - sf!.closing.p50);
    const safe = simulate({
      today: TODAY,
      openingBalancePaise: 90_000_000,
      bufferPaise: 0,
      invoices,
      customers,
      models,
      occurrences: [],
      runs: 100,
    });
    expect(explainShortfall(safe)).toBeNull();
  });
  it('chase score reproduces the engine score for every invoice', () => {
    const items = chaseScores({ today: TODAY, forecast: f, invoices, customers, models });
    for (const it of items) {
      const grade = modelFor(models, it.customerId).grade;
      const e = explainChaseScore(it, grade);
      expect(e.value).toBeCloseTo(it.score, 6);
    }
  });
  it('solver cost equals the plan total and lists every step', () => {
    const plan = solveGap({
      today: TODAY,
      forecast: f,
      invoices,
      customers,
      models,
      occurrences: bill,
    })!;
    expect(plan).not.toBeNull();
    const e = explainSolverCost(plan);
    expect(e.value).toBe(plan.totalCostPaise);
    expect(e.inputs.length).toBe(plan.steps.length + 2);
  });
  it('reliability grade and credit limit come from the real engines', () => {
    const d = modelFor(models, 'a');
    const e = explainPayability(d);
    expect(e.inputs.find((i) => i.label === 'Paid invoices (n)')!.value).toBe('8');
    expect(e.value).toBe(d.grade);
    const c = explainCreditLimit({ monthlyBilledPaise: 10_000_000, creditDays: 30, p80Late: 15 });
    expect(c.inputs.map((i) => i.label)).toContain('Credit days');
    expect(c.value).toBe(
      (Math.round((60_000_000 / 180) * 45 * 1.25 * 100) / 100) * 0 +
        Math.round((60_000_000 / 180) * 45 * 1.25),
    );
  });
});

describe('stored invoice total', () => {
  it('shows the stored total and its parts, both state cases', () => {
    const same = explainStoredInvoiceTotal({
      taxable_paise: 1_000_000,
      cgst_paise: 90_000,
      sgst_paise: 90_000,
      igst_paise: 0,
      round_off_paise: 0,
      total_paise: 1_180_000,
    });
    expect(same.value).toBe(1_180_000);
    expect(same.display).toBe('₹11,800.00');
    expect(same.inputs.map((i) => i.label)).toContain('SGST');
    const other = explainStoredInvoiceTotal({
      taxable_paise: 1_000_000,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 180_000,
      round_off_paise: 0,
      total_paise: 1_180_000,
    });
    expect(other.inputs.map((i) => i.label)).toContain('IGST');
  });
});
