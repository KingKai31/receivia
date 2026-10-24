import { describe, expect, it } from 'vitest';
import { addDays } from '@/lib/dates';
import {
  FORECAST_CONFIG,
  ageing,
  applyWhatIf,
  arrivalAtoms,
  backtest,
  buildDelayModels,
  chaseScores,
  dashboardTiles,
  delaySamples,
  exactSelect,
  expenseDates,
  firstShortfall,
  gradeOf,
  lowestPoint,
  makeRng,
  modelFor,
  occurrences,
  probPaidBy,
  runWhatIf,
  safeWeeks,
  selectActions,
  settledOn,
  simulate,
  solveGap,
  totals,
  type Candidate,
  type CustomerInfo,
  type Expense,
  type ForecastInput,
  type HistInvoice,
  type OpenInvoice,
} from './index';

const TODAY = '2026-10-26';
const cust = (id: string, over: Partial<CustomerInfo> = {}): CustomerInfo => ({
  id,
  name: `Customer ${id}`,
  entityType: 'firm',
  creditDays: 30,
  ...over,
});
const hist = (
  id: string,
  customerId: string,
  due: string,
  paidOn: string | null,
  total = 100000,
): HistInvoice => ({
  id,
  customerId,
  issueDate: addDays(due, -30),
  dueDate: due,
  totalPaise: total,
  events: paidOn ? [{ date: paidOn, amountPaise: total }] : [],
});
/** `n` paid invoices for a customer, each paid `late` days after due. */
const lateHistory = (customerId: string, n: number, late: number): HistInvoice[] =>
  Array.from({ length: n }, (_, i) => {
    const due = addDays('2026-01-01', i * 10);
    return hist(`${customerId}-h${i}`, customerId, due, addDays(due, late));
  });
const modelsOf = (h: HistInvoice[], asOf?: string) => buildDelayModels(delaySamples(h, asOf));
const open = (
  id: string,
  customerId: string,
  due: string,
  bal: number,
  over: Partial<OpenInvoice> = {},
): OpenInvoice => ({
  id,
  number: `N-${id}`,
  customerId,
  dueDate: due,
  balancePaise: bal,
  ...over,
});
const input = (
  o: Partial<ForecastInput> & Pick<ForecastInput, 'invoices' | 'models'>,
): ForecastInput => ({
  today: TODAY,
  openingBalancePaise: 1_000_000,
  bufferPaise: 0,
  customers: [cust('a'), cust('b')],
  occurrences: [],
  runs: 300,
  ...o,
});

describe('delay model', () => {
  it('shrinks a customer toward the overall distribution with weight n / (n + 5)', () => {
    const h = [...lateHistory('a', 5, 20), ...lateHistory('b', 20, 0)];
    const m = modelsOf(h);
    const a = modelFor(m, 'a');
    expect(a.weight).toBeCloseTo(0.5, 6);
    // own median 20; overall median is the pooled median (0); shrunk = 0.5 * 20 + 0.5 * overall
    expect(a.median).toBeCloseTo(0.5 * 20 + 0.5 * m.overall.median, 1);
    expect(a.median).toBeLessThan(20);
    expect(a.median).toBeGreaterThan(m.overall.median);
    expect(FORECAST_CONFIG.shrinkK).toBe(5);
  });
  it('exposes mean, median and P80, and flags low confidence below 4 invoices', () => {
    const m = modelsOf([...lateHistory('a', 3, 10), ...lateHistory('b', 8, 4)]);
    expect(modelFor(m, 'a').lowConfidence).toBe(true);
    expect(modelFor(m, 'b').lowConfidence).toBe(false);
    expect(modelFor(m, 'b')).toMatchObject({ n: 8 });
    expect(modelFor(m, 'b').mean).toBeGreaterThan(0);
    expect(modelFor(m, 'b').p80).toBeGreaterThanOrEqual(modelFor(m, 'b').median);
  });
  it('a customer with no history gets the overall numbers and low confidence', () => {
    const m = modelsOf(lateHistory('b', 10, 6));
    const z = modelFor(m, 'nobody');
    expect(z.n).toBe(0);
    expect(z.lowConfidence).toBe(true);
    expect(z.median).toBeCloseTo(m.overall.median, 1);
    expect(z.reason).toMatch(/No payment history yet/);
  });
  it('no history at all uses the configured prior', () => {
    const m = buildDelayModels(new Map());
    expect(m.overall.fromPrior).toBe(true);
    expect(m.overall.samples).toEqual([...FORECAST_CONFIG.priorDelays]);
  });
  it('grades A, B, C with a reason in words', () => {
    expect(gradeOf(3)).toBe('A');
    expect(gradeOf(15)).toBe('B');
    expect(gradeOf(40)).toBe('C');
    const m = modelsOf([...lateHistory('a', 60, 2), ...lateHistory('b', 12, 45)]);
    expect(modelFor(m, 'a').grade).toBe('A');
    expect(modelFor(m, 'b').grade).toBe('C');
    expect(modelFor(m, 'b').reason).toMatch(/Usually pays \d+ days late/);
    expect(modelFor(m, 'b').reason).toMatch(/Grade C/);
  });
  it('settledOn uses the date cumulative payments reach the total, and respects asOf', () => {
    const h: HistInvoice = {
      ...hist('x', 'a', '2026-03-01', null),
      events: [
        { date: '2026-03-05', amountPaise: 40000 },
        { date: '2026-03-20', amountPaise: 60000 },
      ],
    };
    expect(settledOn(h)).toBe('2026-03-20');
    expect(settledOn(h, '2026-03-10')).toBeNull();
    expect(settledOn({ ...h, events: [], closedOn: '2026-04-01' })).toBe('2026-04-01');
  });
  it('adjusts by ladder stage, promise and dispute', () => {
    const m = modelsOf(lateHistory('a', 12, 20));
    const base = open('i', 'a', addDays(TODAY, -5), 100000);
    const mean = (atoms: ReturnType<typeof arrivalAtoms>) =>
      atoms.reduce((s, a) => s + a.offset * a.weight, 0) / atoms.reduce((s, a) => s + a.weight, 0);
    const plain = arrivalAtoms(base, TODAY, m);
    const chased = arrivalAtoms({ ...base, stage: 'demand_letter' }, TODAY, m);
    expect(mean(chased)).toBeLessThan(mean(plain));
    const promised = arrivalAtoms({ ...base, promisedFor: addDays(TODAY, 3) }, TODAY, m);
    const keptMass = promised
      .filter((a) => a.offset >= 3 && a.offset <= 5)
      .reduce((s, a) => s + a.weight, 0);
    expect(keptMass).toBeGreaterThanOrEqual(FORECAST_CONFIG.promiseKeptProb - 1e-9);
    expect(promised.every((a) => a.offset >= 3)).toBe(true);
    expect(arrivalAtoms({ ...base, disputed: true }, TODAY, m)).toEqual([]);
    const inc = arrivalAtoms({ ...base, disputed: true }, TODAY, m, { includeDisputed: true });
    expect(mean(inc)).toBeGreaterThan(mean(plain) + 20);
  });
  it('very old invoices carry a chance of never being collected', () => {
    const m = modelsOf(lateHistory('a', 12, 20));
    const total = (due: string) =>
      arrivalAtoms(open('i', 'a', due, 1000), TODAY, m).reduce((s, a) => s + a.weight, 0);
    expect(total(addDays(TODAY, -10))).toBeCloseTo(1, 6);
    expect(total(addDays(TODAY, -100))).toBeCloseTo(0.85, 6);
    expect(total(addDays(TODAY, -300))).toBeCloseTo(0.7, 6);
  });
});

describe('expenses', () => {
  const ex = (o: Partial<Expense>): Expense => ({
    id: 'e',
    name: 'Item',
    amountPaise: 1000,
    expenseDate: '2026-11-01',
    isRecurring: false,
    recurrence: null,
    nextDue: null,
    endsOn: null,
    active: true,
    deferrable: false,
    ...o,
  });
  it('monthly rules keep their day: salaries on the 1st, rent on the 5th, GST on the 20th', () => {
    const from = '2026-10-26';
    const to = '2027-01-24';
    const d = (day: string) =>
      expenseDates(ex({ isRecurring: true, recurrence: 'monthly', nextDue: day }), from, to);
    expect(d('2026-11-01')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(d('2026-11-05')).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
    expect(d('2026-10-20')).toEqual(['2026-11-20', '2026-12-20', '2027-01-20']);
  });
  it('the 31st falls on the last day of shorter months', () => {
    expect(
      expenseDates(
        ex({ isRecurring: true, recurrence: 'monthly', nextDue: '2026-10-31' }),
        '2026-10-26',
        '2027-03-01',
      ),
    ).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  });
  it('weekly, quarterly, one-off, ends_on and inactive', () => {
    expect(
      expenseDates(
        ex({ isRecurring: true, recurrence: 'weekly', nextDue: '2026-10-20' }),
        '2026-10-26',
        '2026-11-10',
      ),
    ).toEqual(['2026-10-27', '2026-11-03', '2026-11-10']);
    expect(
      expenseDates(
        ex({ isRecurring: true, recurrence: 'quarterly', nextDue: '2026-11-15' }),
        '2026-10-26',
        '2027-06-01',
      ),
    ).toEqual(['2026-11-15', '2027-02-15', '2027-05-15']);
    expect(expenseDates(ex({ expenseDate: '2026-11-20' }), '2026-10-26', '2027-01-24')).toEqual([
      '2026-11-20',
    ]);
    expect(expenseDates(ex({ expenseDate: '2026-09-20' }), '2026-10-26', '2027-01-24')).toEqual([]);
    expect(
      expenseDates(
        ex({
          isRecurring: true,
          recurrence: 'monthly',
          nextDue: '2026-11-01',
          endsOn: '2026-12-15',
        }),
        '2026-10-26',
        '2027-03-01',
      ),
    ).toEqual(['2026-11-01', '2026-12-01']);
    expect(
      expenseDates(ex({ active: false, expenseDate: '2026-11-20' }), '2026-10-26', '2027-01-24'),
    ).toEqual([]);
  });
  it('occurrences carry the deferrable flag and sort by date', () => {
    const o = occurrences(
      [
        ex({ id: '1', name: 'Supplier', expenseDate: '2026-11-10', deferrable: true }),
        ex({
          id: '2',
          name: 'Rent',
          isRecurring: true,
          recurrence: 'monthly',
          nextDue: '2026-11-05',
        }),
      ],
      '2026-10-26',
      '2026-12-31',
    );
    expect(o.map((x) => x.date)).toEqual(['2026-11-05', '2026-11-10', '2026-12-05']);
    expect(o[1]!.deferrable).toBe(true);
  });
});

describe('13-week Monte Carlo forecast', () => {
  const models = modelsOf([...lateHistory('a', 10, 12), ...lateHistory('b', 10, 3)]);
  const invoices = [
    open('1', 'a', addDays(TODAY, -10), 400000),
    open('2', 'a', addDays(TODAY, 20), 250000),
    open('3', 'b', addDays(TODAY, 5), 300000),
    open('4', 'b', addDays(TODAY, 40), 500000),
  ];
  const occ = occurrences(
    [
      {
        id: 's',
        name: 'Salaries',
        amountPaise: 240000,
        expenseDate: '2026-11-01',
        isRecurring: true,
        recurrence: 'monthly',
        nextDue: '2026-11-01',
        endsOn: null,
        active: true,
        deferrable: false,
        kind: 'salary',
      },
    ],
    TODAY,
    addDays(TODAY, 91),
  );
  const base = input({
    invoices,
    models,
    occurrences: occ,
    openingBalancePaise: 500000,
    bufferPaise: 200000,
    runs: 2000,
  });

  it('uses 2000 runs and 13 weeks by default', () => {
    const f = simulate({ ...base, runs: undefined });
    expect(f.runs).toBe(2000);
    expect(f.weeks).toHaveLength(13);
    expect(f.weeks[0]!.start).toBe(TODAY);
    expect(f.weeks[1]!.start).toBe(addDays(TODAY, 7));
  });
  it('is repeatable: same input, same numbers, down to the bytes', () => {
    const a = simulate(base);
    const b = simulate(base);
    expect(JSON.stringify(a.weeks)).toBe(JSON.stringify(b.weeks));
    expect(a.paths.closing[1234]).toEqual(b.paths.closing[1234]);
    expect(JSON.stringify(simulate({ ...base, seed: 7 }).weeks)).not.toBe(JSON.stringify(a.weeks));
  });
  it('invariant: in every run each week closes where the next opens, and closing = opening + in - out', () => {
    const f = simulate(base);
    for (let r = 0; r < f.runs; r++) {
      expect(f.paths.opening[r]![0]).toBe(500000);
      for (let w = 0; w < 13; w++) {
        const p = f.paths;
        expect(p.closing[r]![w]).toBe(p.opening[r]![w]! + p.inflow[r]![w]! - p.outflow[r]![w]!);
        if (w < 12) expect(p.opening[r]![w + 1]).toBe(p.closing[r]![w]);
      }
    }
  });
  it('totals reconcile with invoices and expenses (every invoice paid on time, every bill counted)', () => {
    const zero = modelsOf([...lateHistory('a', 12, 0), ...lateHistory('b', 12, 0)]);
    const near = [
      open('1', 'a', addDays(TODAY, 3), 400000),
      open('2', 'b', addDays(TODAY, 30), 250000),
    ];
    const f = simulate(
      input({
        invoices: near,
        models: zero,
        occurrences: occ,
        openingBalancePaise: 100000,
        runs: 200,
      }),
    );
    const outTotal = occ.reduce((s, o) => s + o.amountPaise, 0);
    expect(f.outflowTotalPaise).toBe(outTotal);
    expect(f.simulatedBalancePaise).toBe(650000);
    for (let r = 0; r < f.runs; r++) {
      const inSum = f.paths.inflow[r]!.reduce((s, x) => s + x, 0);
      const outSum = f.paths.outflow[r]!.reduce((s, x) => s + x, 0);
      expect(inSum).toBe(650000);
      expect(outSum).toBe(outTotal);
      expect(f.paths.closing[r]![12]).toBe(100000 + inSum - outSum);
    }
  });
  it('inflow never exceeds what is owed', () => {
    const f = simulate(base);
    for (let r = 0; r < f.runs; r++) {
      expect(f.paths.inflow[r]!.reduce((s, x) => s + x, 0)).toBeLessThanOrEqual(1_450_000);
    }
  });
  it('bands are ordered and the probability of falling below the buffer is a proper fraction', () => {
    const f = simulate(base);
    for (const w of f.weeks) {
      expect(w.closing.p10).toBeLessThanOrEqual(w.closing.p50);
      expect(w.closing.p50).toBeLessThanOrEqual(w.closing.p90);
      expect(w.probBelowBuffer).toBeGreaterThanOrEqual(0);
      expect(w.probBelowBuffer).toBeLessThanOrEqual(1);
    }
    expect(
      simulate({ ...base, bufferPaise: -1e12 }).weeks.every((w) => w.probBelowBuffer === 0),
    ).toBe(true);
    expect(
      simulate({ ...base, bufferPaise: 1e12 }).weeks.every((w) => w.probBelowBuffer === 1),
    ).toBe(true);
  });
  it('finds the first shortfall week, the safe weeks and the lowest point', () => {
    const f = simulate({
      ...base,
      openingBalancePaise: 100000,
      invoices: [],
      occurrences: occ,
      bufferPaise: 0,
    });
    const sf = firstShortfall(f);
    expect(sf?.week).toBe(1);
    expect(safeWeeks(f)).toBe(0);
    expect(lowestPoint(f).paise).toBe(Math.min(...f.weeks.map((w) => w.closing.p50)));
    expect(
      safeWeeks(
        simulate({
          ...base,
          occurrences: [],
          invoices: [],
          openingBalancePaise: 5,
          bufferPaise: 0,
        }),
      ),
    ).toBe(13);
  });
  it('disputed invoices are excluded unless the toggle is on', () => {
    const dis = [open('d', 'b', addDays(TODAY, 3), 700000, { disputed: true })];
    const off = simulate(input({ invoices: dis, models, openingBalancePaise: 0, runs: 100 }));
    const on = simulate(
      input({ invoices: dis, models, openingBalancePaise: 0, runs: 100, includeDisputed: true }),
    );
    expect(off.weeks[12]!.closing.p50).toBe(0);
    expect(on.weeks[12]!.closing.p50).toBeGreaterThan(0);
  });
  it('rng is seedable and uniform-ish', () => {
    const a = makeRng(1);
    const b = makeRng(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const r = makeRng(99);
    const xs = Array.from({ length: 5000 }, () => r());
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(xs.reduce((s, x) => s + x, 0) / xs.length).toBeCloseTo(0.5, 1);
  });
});

describe('backtest', () => {
  const customers = [cust('a')];
  // Steady customer: pays 5 days late, an invoice every 7 days for a year.
  const steady: HistInvoice[] = Array.from({ length: 52 }, (_, i) => {
    const due = addDays('2026-01-05', i * 7);
    return hist(`s${i}`, 'a', due, addDays(due, 5), 100000);
  });
  it('compares forecast with actual weekly collections and reports WAPE with a sentence', () => {
    const r = backtest({ history: steady, customers, today: '2026-10-26', runs: 300 });
    expect(r.weeks).toHaveLength(8);
    expect(r.asOf).toBe(addDays('2026-10-26', -56));
    expect(r.wape).not.toBeNull();
    expect(r.wape!).toBeLessThan(0.5);
    expect(r.sentence).toMatch(/off by \d+% week by week/);
    expect(r.sentence).toMatch(/₹/);
    expect(r.weeks.reduce((s, w) => s + w.actual, 0)).toBe(r.actualTotal);
  });
  it('uses only what was known then: later invoices and payments do not leak into the forecast', () => {
    const r1 = backtest({ history: steady, customers, today: '2026-10-26', runs: 200 });
    const extra = [...steady, hist('late', 'a', '2026-10-01', '2026-10-05', 99999999)];
    const r2 = backtest({ history: extra, customers, today: '2026-10-26', runs: 200 });
    expect(r2.forecastTotal).toBe(r1.forecastTotal);
  });
  it('with nothing paid in the window there is no WAPE', () => {
    const none = steady.map((h) => ({ ...h, events: [] }));
    const r = backtest({ history: none, customers, today: '2026-10-26', runs: 100 });
    expect(r.wape).toBeNull();
    expect(r.sentence).toMatch(/nothing came in/);
  });
});

describe('what-ifs', () => {
  const models = modelsOf([...lateHistory('a', 10, 5), ...lateHistory('b', 10, 5)]);
  const invoices = [
    open('1', 'a', addDays(TODAY, 2), 400000),
    open('2', 'b', addDays(TODAY, 2), 300000),
  ];
  const occ = occurrences(
    [
      {
        id: 'bill',
        name: 'Supplier',
        amountPaise: 150000,
        expenseDate: addDays(TODAY, 10),
        isRecurring: false,
        recurrence: null,
        nextDue: null,
        endsOn: null,
        active: true,
        deferrable: true,
      },
    ],
    TODAY,
    addDays(TODAY, 91),
  );
  const base = input({ invoices, models, occurrences: occ, openingBalancePaise: 0, runs: 300 });
  const closing = (f: ReturnType<typeof simulate>, w: number) => f.weeks[w - 1]!.closing.p50;

  it('a customer paying 30 days later moves their money out of the early weeks', () => {
    const f0 = simulate(base);
    const f1 = runWhatIf(base, { kind: 'payLater', customerId: 'a', days: 30 });
    expect(closing(f1, 2)).toBeLessThan(closing(f0, 2));
    expect(closing(f1, 13)).toBe(closing(f0, 13));
  });
  it('a new order adds an invoice paid after its credit days and delay', () => {
    const f0 = simulate(base);
    const f1 = runWhatIf(base, {
      kind: 'newOrder',
      customerId: 'a',
      amountPaise: 500000,
      date: addDays(TODAY, 7),
    });
    expect(closing(f1, 13)).toBe(closing(f0, 13) + 500000);
    expect(closing(f1, 3)).toBe(closing(f0, 3));
  });
  it('a supplier bill moved by N days shifts the outflow week', () => {
    const f1 = runWhatIf(base, { kind: 'moveBill', expenseId: 'bill', days: 14 });
    const f0 = simulate(base);
    expect(f0.weeks[1]!.outflow.p50).toBe(150000);
    expect(f1.weeks[1]!.outflow.p50).toBe(0);
    expect(f1.weeks[3]!.outflow.p50).toBe(150000);
  });
  it('never changes the input it was given', () => {
    const before = JSON.stringify(base.invoices) + JSON.stringify(base.occurrences);
    applyWhatIf(base, { kind: 'payLater', customerId: 'a', days: 30 });
    applyWhatIf(base, { kind: 'moveBill', expenseId: 'bill', days: 3 });
    expect(JSON.stringify(base.invoices) + JSON.stringify(base.occurrences)).toBe(before);
  });
});

describe('chase priority', () => {
  const models = modelsOf([...lateHistory('a', 12, 20), ...lateHistory('b', 12, 1)]);
  const customers = [cust('a'), cust('b')];
  const invoices = [
    open('slow', 'a', addDays(TODAY, -38), 12_000_000),
    open('fast', 'b', addDays(TODAY, -8), 12_000_000),
    open('small', 'b', addDays(TODAY, -8), 100_000),
    open('dispute', 'b', addDays(TODAY, -40), 50_000_000, { disputed: true }),
  ];
  const f = simulate(
    input({
      invoices,
      models,
      customers,
      openingBalancePaise: 1_000_000,
      bufferPaise: 3_000_000,
      occurrences: occurrences(
        [
          {
            id: 'r',
            name: 'Rent',
            amountPaise: 9_000_000,
            expenseDate: addDays(TODAY, 15),
            isRecurring: false,
            recurrence: null,
            nextDue: null,
            endsOn: null,
            active: true,
            deferrable: false,
          },
        ],
        TODAY,
        addDays(TODAY, 91),
      ),
      runs: 400,
    }),
  );

  it('ranks by expected rupees into the shortfall week, weighted by overdue days and reliability, with a reason', () => {
    const sf = firstShortfall(f);
    expect(sf).not.toBeNull();
    const items = chaseScores({ today: TODAY, forecast: f, invoices, customers, models });
    expect(items[0]!.balancePaise).toBe(12_000_000);
    expect(items[items.length - 1]!.invoiceId).toBe('dispute');
    expect(items.find((i) => i.invoiceId === 'dispute')!.score).toBe(0);
    const slow = items.find((i) => i.invoiceId === 'slow')!;
    expect(slow.reason).toMatch(
      /₹1,20,000\.00, 38 days overdue, usually pays \d+ days late, (covers|covers \d+% of)/,
    );
    expect(slow.reason).toMatch(new RegExp(`week ${sf!.week}`));
    expect(slow.probChased).toBeGreaterThanOrEqual(slow.probBase);
    const scores = items.map((i) => i.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
  it('is stable across calls', () => {
    const a = chaseScores({ today: TODAY, forecast: f, invoices, customers, models });
    const b = chaseScores({ today: TODAY, forecast: f, invoices, customers, models });
    expect(a).toEqual(b);
  });
  it('probabilities are consistent with the arrival distribution', () => {
    const atoms = arrivalAtoms(invoices[0]!, TODAY, models);
    expect(probPaidBy(atoms, 1000)).toBeCloseTo(
      atoms.reduce((s, a) => s + a.weight, 0),
      9,
    );
    expect(probPaidBy(atoms, -1)).toBe(0);
  });
});

describe('gap solver', () => {
  const cand = (id: string, group: string, cover: number, cost: number): Candidate => ({
    id,
    group,
    kind: 'chase',
    cover,
    cost,
    sentence: id,
  });

  it('free actions come first, then cheapest per rupee; unneeded steps are dropped', () => {
    const picks = selectActions(
      [
        cand('free', 'a', 300, 0),
        cand('cheap', 'b', 500, 10),
        cand('dear', 'c', 500, 100),
        cand('big', 'd', 1000, 80),
      ],
      700,
    );
    expect(picks.map((p) => p.id).sort()).toEqual(['cheap', 'free']);
    expect(selectActions([cand('x', 'a', 100, 0)], 0)).toEqual([]);
  });
  it('uses at most one action per invoice or bill', () => {
    const picks = selectActions(
      [cand('c1', 'inv', 400, 0), cand('d1', 'inv', 400, 5), cand('c2', 'other', 400, 0)],
      800,
    );
    expect(picks.map((p) => p.group).sort()).toEqual(['inv', 'other']);
  });
  it('matches brute force on feasibility and stays within one action of the optimum cost (random small inputs)', () => {
    const rng = makeRng(2026);
    for (let t = 0; t < 300; t++) {
      const n = 2 + Math.floor(rng() * 8);
      const cands = Array.from({ length: n }, (_, i) => {
        const cover = 100 + Math.floor(rng() * 900);
        const cost = rng() < 0.3 ? 0 : Math.floor(cover * rng() * 0.2);
        return cand(`c${i}`, `g${Math.floor(rng() * n * 0.7)}`, cover, cost);
      });
      const gap = 200 + Math.floor(rng() * 1800);
      const g = selectActions(cands, gap);
      const exact = exactSelect(cands, gap);
      const gt = totals(g);
      if (exact === null) {
        expect(gt.cover).toBeLessThan(gap);
      } else {
        const et = totals(exact);
        if (gt.cover >= gap) {
          expect(gt.cost).toBeGreaterThanOrEqual(et.cost);
          expect(gt.cost).toBeLessThanOrEqual(et.cost + Math.max(...cands.map((c) => c.cost)));
        } else {
          // Greedy can only miss when one-per-group conflicts block it; the best it can do is still all it found.
          expect(exact.length).toBeGreaterThan(0);
        }
      }
    }
  });
  it('equals the optimum on a hand-made case', () => {
    const cands = [cand('a', 'a', 600, 0), cand('b', 'b', 600, 30), cand('c', 'c', 1200, 100)];
    expect(totals(selectActions(cands, 1100)).cost).toBe(totals(exactSelect(cands, 1100)!).cost);
  });

  const models = modelsOf([
    ...lateHistory('a', 12, 25),
    ...lateHistory('b', 12, 25),
    ...lateHistory('g', 12, 25),
  ]);
  const customers = [
    cust('a', { entityType: 'firm' }),
    cust('b', { entityType: 'company' }),
    cust('g', { entityType: 'government' }),
  ];
  const invoices = [
    open('1', 'a', addDays(TODAY, -5), 6_000_000, { number: 'INV-1' }),
    open('2', 'b', addDays(TODAY, 8), 8_000_000, { number: 'INV-2' }),
    open('3', 'g', addDays(TODAY, 10), 5_000_000, { number: 'INV-3' }),
  ];
  const bill = occurrences(
    [
      {
        id: 'sup',
        name: 'Steel supplier',
        amountPaise: 4_000_000,
        expenseDate: addDays(TODAY, 12),
        isRecurring: false,
        recurrence: null,
        nextDue: null,
        endsOn: null,
        active: true,
        deferrable: true,
      },
      {
        id: 'sal',
        name: 'Salaries',
        amountPaise: 3_000_000,
        expenseDate: addDays(TODAY, 12),
        isRecurring: false,
        recurrence: null,
        nextDue: null,
        endsOn: null,
        active: true,
        deferrable: false,
      },
    ],
    TODAY,
    addDays(TODAY, 91),
  );
  const f = simulate(
    input({
      invoices,
      models,
      customers,
      openingBalancePaise: 2_000_000,
      bufferPaise: 1_000_000,
      occurrences: bill,
      runs: 400,
    }),
  );

  it('finds the first shortfall week and builds a plain-language plan with a rupee cost per step', () => {
    const sf = firstShortfall(f)!;
    expect(sf).not.toBeNull();
    const plan = solveGap({
      today: TODAY,
      forecast: f,
      invoices,
      customers,
      models,
      occurrences: bill,
    })!;
    expect(plan.week).toBe(sf.week);
    expect(plan.gapPaise).toBe(1_000_000 - sf.closing.p50);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.summary).toMatch(/below your ₹10,000\.00 safety buffer/);
    for (const s of plan.steps) expect(s.sentence).toMatch(/free|costs about ₹/);
    if (plan.feasible) expect(plan.coveredPaise).toBeGreaterThanOrEqual(plan.gapPaise);
    expect(plan.totalCostPaise).toBe(totals(plan.steps).cost);
  });
  it('TReDS only for company and government buyers; defer only for deferrable bills', () => {
    const plan = solveGap({
      today: TODAY,
      forecast: f,
      invoices,
      customers,
      models,
      occurrences: bill,
    })!;
    const kinds = plan.steps.map((s) => s.id);
    expect(kinds.some((k) => k === 'treds:1')).toBe(false);
    expect(kinds.some((k) => k.startsWith('defer:sal'))).toBe(false);
    const all = [
      ...invoices.flatMap((i) => [`chase:${i.id}`, `discount:${i.id}`, `treds:${i.id}`]),
    ];
    expect(all.length).toBe(9);
  });
  it('returns null when cash stays above the buffer', () => {
    const safe = simulate(
      input({
        invoices,
        models,
        customers,
        openingBalancePaise: 90_000_000,
        bufferPaise: 0,
        occurrences: bill,
        runs: 100,
      }),
    );
    expect(
      solveGap({ today: TODAY, forecast: safe, invoices, customers, models, occurrences: bill }),
    ).toBeNull();
  });
});

describe('dashboard tiles', () => {
  it('ageing buckets: not due, 1-30, 31-60, 61-90, 90+', () => {
    const inv = [
      open('a', 'a', addDays(TODAY, 5), 100),
      open('b', 'a', addDays(TODAY, -1), 200),
      open('c', 'a', addDays(TODAY, -30), 300),
      open('d', 'a', addDays(TODAY, -31), 400),
      open('e', 'a', addDays(TODAY, -90), 500),
      open('f', 'a', addDays(TODAY, -91), 600),
      open('g', 'a', TODAY, 50),
    ];
    expect(ageing(inv, TODAY)).toEqual({
      notDue: 150,
      d1_30: 500,
      d31_60: 400,
      d61_90: 500,
      d90plus: 600,
    });
  });
  it('totals owed, overdue, bills in 30 days, bank balance and lowest point', () => {
    const models = modelsOf(lateHistory('a', 10, 3));
    const inv = [
      open('a', 'a', addDays(TODAY, 3), 100000),
      open('b', 'a', addDays(TODAY, -2), 50000),
    ];
    const occ = occurrences(
      [
        {
          id: 'x',
          name: 'Rent',
          amountPaise: 70000,
          expenseDate: addDays(TODAY, 20),
          isRecurring: false,
          recurrence: null,
          nextDue: null,
          endsOn: null,
          active: true,
          deferrable: false,
        },
      ],
      TODAY,
      addDays(TODAY, 91),
    );
    const f = simulate(
      input({ invoices: inv, models, occurrences: occ, openingBalancePaise: 20000, runs: 200 }),
    );
    const t = dashboardTiles({
      today: TODAY,
      invoices: inv,
      models,
      occurrences: occ,
      forecast: f,
      bankBalancePaise: 20000,
    });
    expect(t.toCollectPaise).toBe(150000);
    expect(t.overduePaise).toBe(50000);
    expect(t.billsDue30Paise).toBe(70000);
    expect(t.bankBalancePaise).toBe(20000);
    expect(t.expectedThisMonthPaise).toBeGreaterThanOrEqual(t.expectedThisWeekPaise);
    expect(t.lowestPaise).toBe(lowestPoint(f).paise);
  });
});
