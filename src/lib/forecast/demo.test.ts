import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS data module shared with scripts/seed-demo.mjs
import * as story from '../../../supabase/seed/demo-story.mjs';
// @ts-expect-error generated bundle of this folder (node scripts/build-agent.mjs)
import * as bundle from '../../../supabase/seed/forecast.bundle.js';
import { addDays } from '@/lib/dates';
import { backtest, firstShortfall, modelFor, runWhatIf, simulate, solveGap } from './index';

/**
 * The demo story (Shree Ganesh Corrugators) rebuilt from supabase/seed/demo-story.mjs. The seed calibrates the
 * opening balance so week 3 is short by about ₹1,30,000; this must hold on any day the demo is seeded.
 */
const DATES = ['2026-10-26', '2026-11-03', '2026-11-12', '2026-11-19', '2026-11-27', '2026-12-05'];

const build = (today: string) => {
  const opening = story.calibrateOpening(bundle, today) as number;
  const d = story.forecastInput(bundle, today, opening);
  return { opening, ...d, f: simulate(d.input) };
};

describe('demo org story', () => {
  const d = build('2026-10-26');
  const T = '2026-10-26';

  it('has 12 customers, about 45 invoices over 6 months, GSTINs with valid check digits', () => {
    expect(story.CUSTOMERS).toHaveLength(12);
    expect(story.buildInvoices(T).length).toBeGreaterThanOrEqual(40);
    expect(d.hist.map((h: { issueDate: string }) => h.issueDate).sort()[0] <= addDays(T, -150)).toBe(true);
    expect(story.gstin('27', 'AAPFU0939F')).toBe('27AAPFU0939F1ZV');
  });
  it('tells the headline story: Mithai Sweets, 38 days overdue, ₹1,18,000 with IGST', () => {
    const b = story.beats(story.buildInvoices(T));
    expect(b.mithaiOverdue.total_paise).toBe(11800000);
    expect(b.mithaiOverdue.igst).toBe(1800000);
    expect(b.mithaiOverdue.due_off).toBe(-38);
  });
  it('salaries are ₹2,40,000 on the 1st', () => {
    const sal = d.occ.filter((o: { name: string }) => o.name === 'Salaries');
    expect(sal.length).toBeGreaterThanOrEqual(3);
    expect(sal.every((o: { amountPaise: number; date: string }) => o.amountPaise === 24000000 && o.date.endsWith('-01'))).toBe(true);
  });
  it.each(DATES)('week 3 is the first shortfall by about ₹1,30,000 and the solver covers it (%s)', (today) => {
    const x = build(today);
    const s = firstShortfall(x.f);
    expect(s?.week).toBe(3);
    const gap = story.BUFFER_PAISE - x.f.weeks[2]!.closing.p50;
    expect(Math.abs(gap - 13000000)).toBeLessThan(200000);
    const plan = solveGap({
      today,
      forecast: x.f,
      invoices: x.open,
      customers: x.customers,
      models: x.models,
      occurrences: x.occ,
    })!;
    expect(plan.feasible).toBe(true);
    expect(plan.coveredPaise).toBeGreaterThanOrEqual(plan.gapPaise);
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
  });
  it('gives identical results on every load', () => {
    expect(JSON.stringify(build(T).f.weeks)).toBe(JSON.stringify(d.f.weeks));
  });
  it('mixes reliable and slow payers', () => {
    const grades = new Set(d.customers.map((c: { id: string }) => modelFor(d.models, c.id).grade));
    expect(grades.has('A')).toBe(true);
    expect(grades.has('C')).toBe(true);
  });
  it('backtest and what-ifs run in well under a second each', () => {
    const t0 = Date.now();
    const bt = backtest({ history: d.hist, customers: d.customers, today: T });
    expect(bt.weeks).toHaveLength(8);
    runWhatIf(d.input, { kind: 'payLater', customerId: 'bharat', days: 30 });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
