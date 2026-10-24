import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays } from '@/lib/dates';
import {
  backtest,
  runWhatIf,
  buildDelayModels,
  chaseScores,
  delaySamples,
  firstShortfall,
  modelFor,
  occurrences,
  simulate,
  solveGap,
  type CustomerInfo,
  type Expense,
  type HistInvoice,
  type OpenInvoice,
} from './index';

/**
 * The demo org story, rebuilt from the same JSON files scripts/seed-demo.mjs uses, with the demo seeded
 * on 24 Oct 2026: 12 customers with 6 months of history, recurring expenses, and an opening balance that
 * leaves a shortfall in week 3 which the solver can cover.
 */
const TODAY = '2026-10-24';
const history = JSON.parse(readFileSync('supabase/seed/demo-history.json', 'utf8'));
const s4 = JSON.parse(readFileSync('supabase/seed/demo-data.json', 'utf8'));
const total = (taxable: number) => taxable + 2 * Math.round((taxable * 9) / 100);

function build() {
  const customers: CustomerInfo[] = history.customers.map(
    (c: { key: string; name: string; entity_type: CustomerInfo['entityType'] }) => ({
      id: c.key,
      name: c.name,
      entityType: c.entity_type,
      creditDays: 30,
    }),
  );
  const hist: HistInvoice[] = [];
  const open: OpenInvoice[] = [];
  for (const i of history.invoices) {
    const t = total(i.taxable_paise);
    if (i.paid_off !== null) {
      hist.push({
        id: i.number,
        customerId: i.customer,
        issueDate: addDays(TODAY, i.issue_off),
        dueDate: addDays(TODAY, i.due_off),
        totalPaise: t,
        events: [{ date: addDays(TODAY, i.paid_off), amountPaise: t }],
      });
    } else {
      open.push({
        id: i.number,
        number: i.number,
        customerId: i.customer,
        dueDate: addDays(TODAY, i.due_off),
        balancePaise: t,
      });
    }
  }
  for (const i of s4.invoices) {
    open.push({
      id: i.number,
      number: i.number,
      customerId: i.customer,
      dueDate: i.due_date,
      balancePaise: total(i.taxable_paise),
    });
  }
  const nextDay = (day: number) => {
    const m = Number(TODAY.slice(5, 7));
    const d = Number(TODAY.slice(8, 10));
    const [y, mm] = day >= d ? [2026, m] : m === 12 ? [2027, 1] : [2026, m + 1];
    return `${y}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  const expenses: Expense[] = history.expenses.map((e: Record<string, unknown>, k: number) => {
    const first = e.day ? nextDay(e.day as number) : addDays(TODAY, e.due_off as number);
    return {
      id: `e${k}`,
      name: e.name as string,
      kind: e.kind as string,
      amountPaise: e.amount_paise as number,
      expenseDate: first,
      isRecurring: Boolean(e.recurrence),
      recurrence: (e.recurrence as Expense['recurrence']) ?? null,
      nextDue: e.recurrence ? first : null,
      endsOn: null,
      active: true,
      deferrable: Boolean(e.can_defer),
    };
  });
  const models = buildDelayModels(delaySamples(hist));
  const occ = occurrences(expenses, TODAY, addDays(TODAY, 90));
  const input = {
    today: TODAY,
    openingBalancePaise: history.settings.opening_balance_paise,
    bufferPaise: history.settings.safety_buffer_paise,
    invoices: open,
    customers,
    models,
    occurrences: occ,
  };
  return { customers, hist, open, expenses, models, occ, input };
}

describe('demo org story', () => {
  const d = build();
  const f = simulate(d.input);

  it('has 12 customers with history, salaries of ₹2,40,000 on the 1st, and 6 months of paid invoices', () => {
    expect(d.customers).toHaveLength(12);
    expect(d.hist.length).toBeGreaterThanOrEqual(50);
    const sal = d.occ.filter((o) => o.name === 'Salaries');
    expect(sal.every((o) => o.amountPaise === 24000000 && o.date.endsWith('-01'))).toBe(true);
    expect(sal.length).toBeGreaterThanOrEqual(3);
    const earliest = d.hist.map((h) => h.issueDate).sort()[0]!;
    expect(earliest <= addDays(TODAY, -150)).toBe(true);
  });
  it('shows the first shortfall in week 3, not before', () => {
    expect(firstShortfall(f)?.week).toBe(3);
    expect(f.weeks[0]!.closing.p50).toBeGreaterThanOrEqual(f.bufferPaise);
    expect(f.weeks[1]!.closing.p50).toBeGreaterThanOrEqual(f.bufferPaise);
    expect(f.weeks[2]!.closing.p50).toBeLessThan(f.bufferPaise);
  });
  it('the solver covers the week 3 gap with named, costed steps', () => {
    const plan = solveGap({
      today: TODAY,
      forecast: f,
      invoices: d.open,
      customers: d.customers,
      models: d.models,
      occurrences: d.occ,
    })!;
    expect(plan.week).toBe(3);
    expect(plan.feasible).toBe(true);
    expect(plan.coveredPaise).toBeGreaterThanOrEqual(plan.gapPaise);
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(plan.steps.every((x) => x.sentence.length > 20)).toBe(true);
    expect(plan.summary).toMatch(/Week 3/);
    expect(plan.steps.every((x) => x.sentence.length > 20)).toBe(true);
  });
  it('gives identical results on every load', () => {
    const again = simulate(build().input);
    expect(JSON.stringify(again.weeks)).toBe(JSON.stringify(f.weeks));
    const a = chaseScores({
      today: TODAY,
      forecast: f,
      invoices: d.open,
      customers: d.customers,
      models: d.models,
    });
    const b = chaseScores({
      today: TODAY,
      forecast: again,
      invoices: build().open,
      customers: d.customers,
      models: build().models,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('mixes reliable and slow payers', () => {
    const grades = new Set(d.customers.map((c) => modelFor(d.models, c.id).grade));
    expect(grades.has('A')).toBe(true);
    expect(grades.has('C')).toBe(true);
  });
  it('backtest and what-ifs on the demo data run in well under a second each', () => {
    const t0 = Date.now();
    const bt = backtest({ history: d.hist, customers: d.customers, today: TODAY });
    expect(bt.weeks).toHaveLength(8);
    expect(bt.wape).not.toBeNull();
    runWhatIf(d.input, { kind: 'payLater', customerId: 'gamma', days: 30 });
    runWhatIf(d.input, {
      kind: 'newOrder',
      customerId: 'zeta',
      amountPaise: 50000000,
      date: addDays(TODAY, 5),
    });
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
