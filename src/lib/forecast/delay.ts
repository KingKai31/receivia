import { daysBetween, type ISODate } from '@/lib/dates';
import { FORECAST_CONFIG } from './config';
import { mean, median, quantile } from './stats';
import type { CustomerDelay, DelayModels, DelayStats, Grade, HistInvoice } from './types';

/** The date an invoice was fully paid as of `asOf`, or null if it was still open then. */
export function settledOn(inv: HistInvoice, asOf?: ISODate): ISODate | null {
  const events = [...inv.events]
    .filter((e) => !asOf || e.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date));
  let paid = 0;
  for (const e of events) {
    paid += e.amountPaise;
    if (paid >= inv.totalPaise) return e.date;
  }
  if (inv.closedOn && (!asOf || inv.closedOn <= asOf)) return inv.closedOn;
  return null;
}

/** Balance left on an invoice as of a date (payments only). */
export function balanceAsOf(inv: HistInvoice, asOf: ISODate): number {
  const paid = inv.events.filter((e) => e.date <= asOf).reduce((s, e) => s + e.amountPaise, 0);
  return Math.max(inv.totalPaise - paid, 0);
}

/** Days late for each paid invoice, per customer, using only what was known at `asOf`. */
export function delaySamples(history: HistInvoice[], asOf?: ISODate): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const inv of history) {
    const s = settledOn(inv, asOf);
    if (!s) continue;
    const list = out.get(inv.customerId) ?? [];
    list.push(daysBetween(inv.dueDate, s));
    out.set(inv.customerId, list);
  }
  return out;
}

export function statsOf(samples: readonly number[]): DelayStats {
  return {
    n: samples.length,
    mean: mean(samples),
    median: median(samples),
    p80: quantile(samples, 0.8),
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function gradeOf(p80: number): Grade {
  if (p80 <= FORECAST_CONFIG.gradeA_p80) return 'A';
  if (p80 <= FORECAST_CONFIG.gradeB_p80) return 'B';
  return 'C';
}

function days(n: number): string {
  const r = Math.round(n);
  if (r === 0) return 'on the due date';
  if (r < 0) return `${-r} day${-r === 1 ? '' : 's'} early`;
  return `${r} day${r === 1 ? '' : 's'} late`;
}

export function describeDelay(c: Omit<CustomerDelay, 'reason'>): string {
  if (c.n === 0) {
    return 'No payment history yet, so this uses your overall average. Treated as low confidence.';
  }
  const base = `Usually pays ${days(c.median)}; 8 in 10 invoices are paid within ${Math.round(c.p80)} days of the due date. Based on ${c.n} paid invoice${c.n === 1 ? '' : 's'}.`;
  const g =
    c.grade === 'A'
      ? ' Grade A: reliable.'
      : c.grade === 'B'
        ? ' Grade B: often a little slow.'
        : ' Grade C: pays late, plan for it.';
  const low = c.lowConfidence
    ? ` Only ${c.n} invoice${c.n === 1 ? '' : 's'} so far, so the estimate leans on your overall average.`
    : '';
  return base + g + low;
}

/**
 * Per-customer delay statistics, shrunk toward the overall distribution:
 * stat = w * own + (1 - w) * overall, with w = n / (n + k). A customer with no history gets the
 * overall numbers. The same weight is used when sampling (see arrival atoms in simulate.ts).
 */
export function buildDelayModels(
  samplesByCustomer: Map<string, number[]>,
  k: number = FORECAST_CONFIG.shrinkK,
): DelayModels {
  const pooled = [...samplesByCustomer.values()].flat();
  const fromPrior = pooled.length === 0;
  const overallSamples = fromPrior ? [...FORECAST_CONFIG.priorDelays] : pooled;
  const overall = { ...statsOf(overallSamples), samples: overallSamples, fromPrior };
  const byCustomer = new Map<string, CustomerDelay>();
  for (const [customerId, samples] of samplesByCustomer) {
    byCustomer.set(customerId, customerDelay(customerId, samples, overall, k));
  }
  return { overall, byCustomer, k };
}

export function customerDelay(
  customerId: string,
  samples: number[],
  overall: DelayStats,
  k: number = FORECAST_CONFIG.shrinkK,
): CustomerDelay {
  const own = statsOf(samples);
  const n = samples.length;
  const weight = n / (n + k);
  const shrunk = {
    mean: weight * own.mean + (1 - weight) * overall.mean,
    median: weight * own.median + (1 - weight) * overall.median,
    p80: weight * own.p80 + (1 - weight) * overall.p80,
  };
  const partial = {
    customerId,
    samples,
    n,
    own,
    weight,
    mean: round1(shrunk.mean),
    median: round1(shrunk.median),
    p80: round1(shrunk.p80),
    lowConfidence: n < FORECAST_CONFIG.lowConfidenceBelow,
    grade: gradeOf(shrunk.p80),
  };
  return { ...partial, reason: describeDelay(partial) };
}

/** Model for a customer; a customer with no history gets the overall numbers, low confidence. */
export function modelFor(models: DelayModels, customerId: string): CustomerDelay {
  return (
    models.byCustomer.get(customerId) ?? customerDelay(customerId, [], models.overall, models.k)
  );
}
