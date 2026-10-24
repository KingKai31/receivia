import { addDays, type ISODate } from '@/lib/dates';
import { formatINR, paise } from '@/lib/money';
import { FORECAST_CONFIG } from './config';
import { balanceAsOf, buildDelayModels, delaySamples } from './delay';
import { simulate } from './simulate';
import type { CustomerInfo, HistInvoice, OpenInvoice } from './types';

export interface BacktestWeek {
  week: number;
  start: ISODate;
  end: ISODate;
  forecast: number;
  p10: number;
  p90: number;
  actual: number;
}

export interface BacktestResult {
  asOf: ISODate;
  weeks: BacktestWeek[];
  forecastTotal: number;
  actualTotal: number;
  /** Weighted absolute percentage error: sum |actual - forecast| / sum actual. Null if nothing came in. */
  wape: number | null;
  sentence: string;
}

/**
 * Hide the last `weeksHidden` weeks of history, forecast weekly collections from what was known
 * then (invoices open on that date, delay history up to that date), and compare with what really
 * came in on those same invoices.
 */
export function backtest(args: {
  history: HistInvoice[];
  customers: CustomerInfo[];
  today: ISODate;
  weeksHidden?: number;
  runs?: number;
  seed?: number;
}): BacktestResult {
  const weeks = args.weeksHidden ?? FORECAST_CONFIG.backtestWeeks;
  const asOf = addDays(args.today, -7 * weeks);
  const start = addDays(asOf, 1);

  const open: OpenInvoice[] = [];
  const openIds = new Set<string>();
  for (const h of args.history) {
    if (h.issueDate > asOf) continue;
    const balance = balanceAsOf(h, asOf);
    if (balance <= 0) continue;
    open.push({ id: h.id, customerId: h.customerId, dueDate: h.dueDate, balancePaise: balance });
    openIds.add(h.id);
  }
  const models = buildDelayModels(delaySamples(args.history, asOf));
  const f = simulate({
    today: start,
    openingBalancePaise: 0,
    bufferPaise: 0,
    invoices: open,
    customers: args.customers,
    models,
    occurrences: [],
    weeks,
    runs: args.runs ?? 500,
    seed: args.seed,
  });

  const rows: BacktestWeek[] = f.weeks.map((w) => {
    let actual = 0;
    for (const h of args.history) {
      if (!openIds.has(h.id)) continue;
      for (const e of h.events) if (e.date >= w.start && e.date <= w.end) actual += e.amountPaise;
    }
    return {
      week: w.week,
      start: w.start,
      end: w.end,
      forecast: w.expectedInflow,
      p10: w.inflow.p10,
      p90: w.inflow.p90,
      actual,
    };
  });
  const forecastTotal = rows.reduce((s, r) => s + r.forecast, 0);
  const actualTotal = rows.reduce((s, r) => s + r.actual, 0);
  const err = rows.reduce((s, r) => s + Math.abs(r.actual - r.forecast), 0);
  const wape = actualTotal > 0 ? err / actualTotal : null;
  return {
    asOf,
    weeks: rows,
    forecastTotal,
    actualTotal,
    wape,
    sentence: sentence(weeks, wape, forecastTotal, actualTotal),
  };
}

function sentence(weeks: number, wape: number | null, forecast: number, actual: number): string {
  if (wape === null) {
    return `In the last ${weeks} weeks nothing came in on the invoices that were open then, so there is nothing to compare yet.`;
  }
  const pct = Math.round(wape * 100);
  const bias =
    forecast > actual * 1.1
      ? 'a bit too optimistic'
      : forecast < actual * 0.9
        ? 'a bit too cautious'
        : 'about right overall';
  return `Looking back ${weeks} weeks, the forecast was off by ${pct}% week by week (WAPE); it expected ${formatINR(paise(forecast))} and ${formatINR(paise(actual))} actually came in, so it was ${bias}.`;
}
