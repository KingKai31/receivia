import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
// @ts-expect-error plain JS data module shared with scripts/seed-demo.mjs
import * as story from '../../../supabase/seed/demo-story.mjs';
import { addDays } from '@/lib/dates';
import { occurrences } from '@/lib/forecast';
import { IMPACT_ASSUMPTIONS, IMPACT_CONFIG } from './config';
import { msmeInterestOwed, roiCard } from './roi';
import { receiviaLateDays, replayImpact, type ReplayInput, type ReplayInvoice } from './replay';

const inv = (
  o: Partial<ReplayInvoice> & { dueDate: string; paidOn: string | null },
): ReplayInvoice => ({
  id: 'x',
  issueDate: addDays(o.dueDate, -30),
  totalPaise: 100000,
  ...o,
});

describe('receiviaLateDays', () => {
  it('leaves early and on-time payers and unpaid invoices alone', () => {
    expect(receiviaLateDays(inv({ dueDate: '2026-06-10', paidOn: '2026-06-05' }))).toBe(-5);
    expect(receiviaLateDays(inv({ dueDate: '2026-06-10', paidOn: '2026-06-10' }))).toBe(0);
    expect(receiviaLateDays(inv({ dueDate: '2026-06-10', paidOn: null }))).toBe(0);
  });
  it('does not change a payment that came before the first reminder stage (day 7)', () => {
    expect(receiviaLateDays(inv({ dueDate: '2026-06-10', paidOn: '2026-06-15' }))).toBe(3);
  });
  it('applies the stage factor to the wait that remains after the latest stage', () => {
    // 20 days late -> 10 after the friendly nudge; firm (day 7, factor 0.9): 7 + 3 x 0.9 = 9.7 -> 10
    expect(receiviaLateDays(inv({ dueDate: '2026-06-10', paidOn: '2026-06-30' }))).toBe(10);
    // 60 days late -> 30; final (day 15, factor 0.8): 15 + 15 x 0.8 = 27
    expect(receiviaLateDays(inv({ dueDate: '2026-06-10', paidOn: '2026-08-09' }))).toBe(27);
  });
  it('removes 70% of hold days first, then recovers half of a missed promise', () => {
    // 10 days late with 10 hold days: (10 - 7) x 0.5 = 1.5; slip capped at 1.5 -> 1.5 - 0.75 = 0.75 -> 1
    expect(
      receiviaLateDays(
        inv({ dueDate: '2026-06-10', paidOn: '2026-06-20', holdDays: 10, promiseSlipDays: 2 }),
      ),
    ).toBe(1);
  });
  it('is never later than what happened and never negative for a late invoice', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 400 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        (late, hold, slip) => {
          const r = receiviaLateDays(
            inv({
              dueDate: '2026-01-01',
              paidOn: addDays('2026-01-01', late),
              holdDays: hold,
              promiseSlipDays: slip,
            }),
          );
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(late);
        },
      ),
    );
  });
});

const base = (invoices: ReplayInvoice[], over: Partial<ReplayInput> = {}): ReplayInput => ({
  asOf: '2026-10-31',
  invoices,
  outflows: [],
  endingBalancePaise: 5_000_000,
  bufferPaise: 1_000_000,
  ...over,
});

describe('replayImpact', () => {
  it('changes nothing when everyone paid on time', () => {
    const r = replayImpact(
      base([
        inv({ dueDate: '2026-09-10', paidOn: '2026-09-10' }),
        inv({ dueDate: '2026-08-10', paidOn: '2026-08-01' }),
      ]),
    );
    expect(r.daysSaved).toBe(0);
    expect(r.borrowingCostAvoidedPaise).toBe(0);
    expect(r.withReceivia).toEqual(r.asHappened);
  });
  it('hand-computed: one invoice 20 days late is paid 10 days sooner', () => {
    const r = replayImpact(base([inv({ dueDate: '2026-09-10', paidOn: '2026-09-30' })]));
    expect(r.daysSaved).toBe(10);
    expect(r.amountPulledForwardPaise).toBe(100000);
    expect(r.paiseDaysSaved).toBe(1000000);
    // 1,000,000 paise-days x 12% / 365 = 328.8 paise
    expect(r.borrowingCostAvoidedPaise).toBe(329);
    expect(r.invoicesPaid).toBe(1);
  });
  it('overdue at month end is lower or equal with Receivia; unpaid invoices are unchanged', () => {
    const r = replayImpact(
      base([
        inv({ dueDate: '2026-08-20', paidOn: '2026-10-15', totalPaise: 500000 }),
        inv({ dueDate: '2026-09-01', paidOn: null, totalPaise: 300000 }),
      ]),
    );
    expect(r.withReceivia.overdueLatestPaise).toBeLessThanOrEqual(r.asHappened.overdueLatestPaise);
    expect(r.asHappened.overdueAtMonthEnd.at(-1)?.monthEnd).toBe('2026-10-31');
    expect(r.asHappened.overdueLatestPaise).toBe(300000);
  });
  it('is deterministic', () => {
    const a = base([inv({ dueDate: '2026-09-10', paidOn: '2026-10-30' })]);
    expect(JSON.stringify(replayImpact(a))).toBe(JSON.stringify(replayImpact(a)));
  });
  it('property: Receivia never collects later, never owes more overdue, never adds shortfall weeks', () => {
    const one = fc.record({
      due: fc.integer({ min: 0, max: 170 }),
      late: fc.integer({ min: -10, max: 120 }),
      unpaid: fc.boolean(),
      amount: fc.integer({ min: 10000, max: 5_000_000 }),
      hold: fc.integer({ min: 0, max: 60 }),
    });
    fc.assert(
      fc.property(fc.array(one, { minLength: 1, maxLength: 25 }), (rows) => {
        const asOf = '2026-10-31';
        const invoices = rows.map((x, k) => {
          const dueDate = addDays(asOf, -x.due);
          const paidOn = x.unpaid ? null : addDays(dueDate, x.late);
          return inv({
            id: String(k),
            dueDate,
            paidOn: paidOn && paidOn > asOf ? asOf : paidOn,
            totalPaise: x.amount,
            holdDays: x.hold,
          });
        });
        const r = replayImpact(
          base(invoices, { outflows: [{ date: addDays(asOf, -20), amountPaise: 400000 }] }),
        );
        expect(r.daysSaved).toBeGreaterThanOrEqual(0);
        expect(r.withReceivia.avgDaysToCollect).toBeLessThanOrEqual(r.asHappened.avgDaysToCollect);
        expect(r.withReceivia.overdueLatestPaise).toBeLessThanOrEqual(
          r.asHappened.overdueLatestPaise,
        );
        expect(r.withReceivia.shortfallWeeks).toBeLessThanOrEqual(r.asHappened.shortfallWeeks);
        expect(r.withReceivia.collectedPaise).toBeGreaterThanOrEqual(r.asHappened.collectedPaise);
      }),
    );
  });
  it('documents every assumption it uses', () => {
    expect(IMPACT_ASSUMPTIONS.join(' ')).toMatch(/70%/);
    expect(IMPACT_ASSUMPTIONS.join(' ')).toMatch(/12% a year/);
    expect(IMPACT_CONFIG.borrowingRatePct).toBe(12);
  });
});

describe('demo org replay and ROI', () => {
  const T = '2026-10-26';
  const invoices = story.buildInvoices(T) as {
    number: string;
    issue: string;
    due: string;
    total_paise: number;
    paid_off: number | null;
  }[];
  const replayIn: ReplayInput = {
    asOf: T,
    invoices: invoices.map((i) => ({
      id: i.number,
      issueDate: i.issue,
      dueDate: i.due,
      totalPaise: i.total_paise,
      paidOn: i.paid_off === null ? null : addDays(T, i.paid_off),
    })),
    outflows: occurrences(story.expenseInputs(T), addDays(T, -190), T).map((o) => ({
      date: o.date,
      amountPaise: o.amountPaise,
    })),
    endingBalancePaise: 15_000_000,
    bufferPaise: story.BUFFER_PAISE,
  };
  const r = replayImpact(replayIn);

  it('shows Receivia collecting sooner with fewer rupees overdue, on the same invoices', () => {
    expect(r.invoicesPaid).toBeGreaterThan(20);
    expect(r.withReceivia.avgDaysToCollect).toBeLessThan(r.asHappened.avgDaysToCollect);
    expect(r.withReceivia.overdueLatestPaise).toBeLessThanOrEqual(r.asHappened.overdueLatestPaise);
    const gain = 1 - r.withReceivia.avgDaysToCollect / r.asHappened.avgDaysToCollect;
    expect(gain).toBeGreaterThanOrEqual(0.15);
    expect(gain).toBeLessThanOrEqual(0.45);
    expect(r.borrowingCostAvoidedPaise).toBeGreaterThan(0);
    expect(r.asHappened.collectedPaise).toBeGreaterThan(0);
    expect(JSON.stringify(replayImpact(replayIn))).toBe(JSON.stringify(r));
  });
  it('ROI card: hours = messages x 3 minutes / 60; MSME interest is 0 for an ineligible seller', () => {
    const card = roiCard({ messagesAutomated: 40, replay: r, msmeInterestPaise: 0 });
    expect(card.hoursSaved).toBe(2);
    expect(card.collectedSoonerPaise).toBe(r.amountPulledForwardPaise);
    const od = [
      {
        balancePaise: 11800000,
        acceptedOn: '2026-07-01',
        creditDays: 30,
        hasWrittenAgreement: true,
      },
    ];
    expect(msmeInterestOwed(od, T, false)).toBe(0);
    expect(msmeInterestOwed(od, T, true)).toBeGreaterThan(0);
  });
});
