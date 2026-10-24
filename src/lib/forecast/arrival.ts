import { daysBetween, type ISODate } from '@/lib/dates';
import { FORECAST_CONFIG } from './config';
import { modelFor } from './delay';
import type { DelayModels, OpenInvoice } from './types';

/** One possible arrival: `offset` days from today (0 = today) with probability `weight`. */
export interface Atom {
  offset: number;
  weight: number;
}

export interface ArrivalOptions {
  includeDisputed?: boolean;
  /** Multiplies the remaining wait (we chased now). 1 = no change. */
  chase?: number;
}

export function badDebtProb(daysOverdue: number): number {
  for (const row of FORECAST_CONFIG.badDebt) if (daysOverdue <= row.maxDays) return row.prob;
  return 0;
}

/**
 * The distribution of when an open invoice will be paid, as weighted atoms. Weights sum to at most 1;
 * the rest is the chance it is never collected (or excluded, for disputed invoices).
 *
 * - Delay samples: the customer's own with weight w = n / (n + k), the overall pool with 1 - w.
 * - The invoice is still unpaid, so arrival cannot be before today: samples that would put it earlier are dropped
 *   and the rest renormalised.
 * - An active promise: with probability promiseKeptProb it arrives on the promised date (+0..2 days).
 * - Reminder stage sent: the remaining wait is scaled by the stage factor; chasing scales it again.
 * - Overdue invoices carry a bad-debt chance. Disputed invoices are excluded unless asked for.
 */
export function arrivalAtoms(
  inv: OpenInvoice,
  today: ISODate,
  models: DelayModels,
  opts: ArrivalOptions = {},
): Atom[] {
  if (inv.disputed && !opts.includeDisputed) return [];
  if (inv.balancePaise <= 0) return [];
  const cfg = FORECAST_CONFIG;
  const toDue = daysBetween(today, inv.dueDate); // negative when overdue
  const overdue = Math.max(0, -toDue);
  const alive = 1 - badDebtProb(overdue);
  const extra = (inv.disputed ? cfg.disputeExtraDays : 0) + (inv.extraDelayDays ?? 0);
  const factor = (cfg.stageFactor[inv.stage ?? ''] ?? 1) * (opts.chase ?? 1);

  const atoms: Atom[] = [];
  let rest = 1;
  if (inv.promisedFor) {
    const p = Math.max(0, daysBetween(today, inv.promisedFor)) + (inv.extraDelayDays ?? 0);
    const kept = cfg.promiseKeptProb;
    for (const add of [0, 1, 2]) atoms.push({ offset: p + add, weight: (kept / 3) * alive });
    rest = 1 - kept;
  }

  const model = modelFor(models, inv.customerId);
  const w = model.n / (model.n + models.k);
  const pool: { delay: number; weight: number }[] = [];
  for (const d of model.samples) pool.push({ delay: d, weight: w / Math.max(model.n, 1) });
  for (const d of models.overall.samples) {
    pool.push({ delay: d, weight: (1 - w) / models.overall.samples.length });
  }
  const minOffset = inv.promisedFor ? Math.max(0, daysBetween(today, inv.promisedFor)) : 0;
  const feasible = pool.filter((s) => toDue + s.delay >= minOffset);
  const total = feasible.reduce((s, x) => s + x.weight, 0);
  if (total > 0) {
    for (const s of feasible) {
      const wait = toDue + s.delay;
      atoms.push({
        offset: Math.max(0, Math.round(wait * factor)) + extra,
        weight: (s.weight / total) * rest * alive,
      });
    }
  } else {
    // Nothing in history is this late yet: assume it lands somewhere in the next 3 to 30 days.
    for (let d = 3; d <= 30; d++) {
      atoms.push({ offset: Math.round(d * factor) + extra, weight: (rest / 28) * alive });
    }
  }
  return atoms;
}

/** Probability the invoice has been paid by `offset` days from today (inclusive). */
export function probPaidBy(atoms: Atom[], offset: number): number {
  let p = 0;
  for (const a of atoms) if (a.offset <= offset) p += a.weight;
  return Math.min(1, p);
}

/** Expected rupees (paise) the invoice brings in by `offset` days from today. */
export function expectedBy(inv: OpenInvoice, atoms: Atom[], offset: number): number {
  return Math.round(inv.balancePaise * probPaidBy(atoms, offset));
}

/** Atoms sorted and with running totals, for fast sampling. */
export interface Sampler {
  offsets: number[];
  cumulative: number[];
}

export function sampler(atoms: Atom[]): Sampler {
  const sorted = [...atoms].sort((a, b) => a.offset - b.offset);
  const offsets: number[] = [];
  const cumulative: number[] = [];
  let c = 0;
  for (const a of sorted) {
    c += a.weight;
    offsets.push(a.offset);
    cumulative.push(c);
  }
  return { offsets, cumulative };
}

/** Draws an arrival offset, or null when the draw falls in the "never collected" mass. */
export function draw(s: Sampler, u: number): number | null {
  const n = s.cumulative.length;
  if (!n || u >= s.cumulative[n - 1]!) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.cumulative[mid]! > u) hi = mid;
    else lo = mid + 1;
  }
  return s.offsets[lo]!;
}
