import { askBooks, type BooksSnapshot } from '@/features/ai/books';
import type { Forecast, WeekBand } from '@/lib/forecast';
import { addDays } from '@/lib/dates';

export const TODAY = '2026-10-25';
const q = (n: number) => ({ p10: n, p50: n, p90: n });
const weeks: WeekBand[] = Array.from({ length: 13 }, (_, i) => ({
  week: i + 1,
  start: addDays(TODAY, i * 7),
  end: addDays(TODAY, i * 7 + 6),
  opening: q(0),
  inflow: q(0),
  outflow: q(0),
  closing: q(i < 2 ? 50_000_000 : 20_000_000),
  probBelowBuffer: i < 2 ? 0.05 : 0.8,
  expectedInflow: 1_000_000,
}));
const inv = (id: string, customerId: string, due: string, bal: number) => ({
  id,
  number: id,
  customerId,
  dueDate: due,
  balancePaise: bal,
});

export const SNAPSHOT: BooksSnapshot = {
  today: TODAY,
  bufferPaise: 30_000_000,
  openingBalancePaise: 50_000_000,
  customers: [
    { id: 'a', name: 'Alpha Traders', stateCode: '24', tier: 'key' },
    { id: 'b', name: 'Beta Mills', stateCode: '24', tier: 'standard' },
    { id: 'g', name: 'Gamma Foods', stateCode: '27', tier: 'standard' },
  ],
  invoices: [
    inv('INV/1', 'a', '2026-09-01', 9_000_000),
    inv('INV/2', 'a', '2026-10-01', 3_000_000),
    inv('INV/3', 'b', '2026-10-10', 4_000_000),
    inv('INV/4', 'g', '2026-10-15', 5_000_000),
    inv('INV/5', 'g', '2026-12-01', 2_000_000),
  ],
  expenses: [
    {
      id: 'e1',
      name: 'Salaries',
      kind: 'salary',
      amountPaise: 24_000_000,
      expenseDate: '2026-11-01',
      isRecurring: true,
      recurrence: 'monthly',
      nextDue: '2026-11-01',
      endsOn: null,
      active: true,
      deferrable: false,
    },
  ],
  occurrences: [
    {
      expenseId: 'e1',
      name: 'Salaries',
      date: '2026-11-01',
      amountPaise: 24_000_000,
      deferrable: false,
    },
  ],
  forecast: {
    today: TODAY,
    runs: 1,
    bufferPaise: 30_000_000,
    weeks,
    paths: { opening: [], inflow: [], outflow: [], closing: [] },
    outflowTotalPaise: 0,
    simulatedBalancePaise: 0,
  } as Forecast,
};

export const ask = (question: string, fetchImpl?: typeof fetch) =>
  askBooks(question, SNAPSHOT, { anthropicKey: fetchImpl ? 'k' : null, fetchImpl });
