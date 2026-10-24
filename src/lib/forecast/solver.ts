import { addDays, daysBetween, type ISODate } from '@/lib/dates';
import { formatINR, paise } from '@/lib/money';
import { arrivalAtoms, probPaidBy } from './arrival';
import { FORECAST_CONFIG } from './config';
import { quantile } from './stats';
import { firstShortfall } from './simulate';
import type { CustomerInfo, DelayModels, Forecast, OpenInvoice, Occurrence } from './types';

export type ActionKind = 'chase' | 'discount' | 'treds' | 'defer';

export interface Candidate {
  id: string;
  /** At most one action per group (an invoice, or a supplier bill). */
  group: string;
  kind: ActionKind;
  /** Expected paise this action adds to the shortfall week's closing balance. */
  cover: number;
  /** Expected cost in paise. */
  cost: number;
  sentence: string;
}

export interface GapPlan {
  week: number;
  start: ISODate;
  end: ISODate;
  bufferPaise: number;
  closingP50: number;
  gapPaise: number;
  steps: Candidate[];
  coveredPaise: number;
  totalCostPaise: number;
  feasible: boolean;
  summary: string;
}

const ratio = (c: Candidate) => (c.cover > 0 ? c.cost / c.cover : Number.POSITIVE_INFINITY);

/**
 * Greedy: take actions by cost per rupee covered (free ones first, then larger cover), one per group,
 * until the gap is covered; then drop any step that is no longer needed, most expensive first.
 */
export function selectActions(candidates: Candidate[], gap: number): Candidate[] {
  if (gap <= 0) return [];
  const sorted = candidates
    .filter((c) => c.cover > 0)
    .sort((a, b) => ratio(a) - ratio(b) || b.cover - a.cover || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const chosen: Candidate[] = [];
  let covered = 0;
  for (const c of sorted) {
    if (covered >= gap) break;
    if (used.has(c.group)) continue;
    used.add(c.group);
    chosen.push(c);
    covered += c.cover;
  }
  for (const c of [...chosen].sort((a, b) => ratio(b) - ratio(a) || b.cost - a.cost)) {
    if (covered - c.cover >= gap) {
      chosen.splice(chosen.indexOf(c), 1);
      covered -= c.cover;
    }
  }
  return chosen;
}

/** Exhaustive minimum-cost selection, for tests on small inputs (up to about 16 candidates). */
export function exactSelect(candidates: Candidate[], gap: number): Candidate[] | null {
  if (gap <= 0) return [];
  const list = candidates.filter((c) => c.cover > 0);
  let best: Candidate[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  const n = list.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const groups = new Set<string>();
    let ok = true;
    let cover = 0;
    let cost = 0;
    const picked: Candidate[] = [];
    for (let i = 0; i < n && ok; i++) {
      if (!(mask & (1 << i))) continue;
      const c = list[i]!;
      if (groups.has(c.group)) ok = false;
      groups.add(c.group);
      cover += c.cover;
      cost += c.cost;
      picked.push(c);
    }
    if (ok && cover >= gap && cost < bestCost) {
      best = picked;
      bestCost = cost;
    }
  }
  return best;
}

export function totals(steps: Candidate[]): { cover: number; cost: number } {
  return {
    cover: steps.reduce((s, c) => s + c.cover, 0),
    cost: steps.reduce((s, c) => s + c.cost, 0),
  };
}

/**
 * Cheapest set of actions to cover the first week below the safety buffer, measured at the median.
 * Actions: chase an invoice (free; covers the extra probability of being paid in time), early-payment
 * discount, TReDS (company and government buyers; cost = rate x days / 365), defer a deferrable bill.
 * Only invoices not expected by then (P(paid by the end of the week) under 50%) are candidates.
 */
export function solveGap(args: {
  today: ISODate;
  forecast: Forecast;
  invoices: OpenInvoice[];
  customers: CustomerInfo[];
  models: DelayModels;
  occurrences: Occurrence[];
}): GapPlan | null {
  const { today, forecast, models } = args;
  const sf = firstShortfall(forecast);
  if (!sf) return null;
  const cfg = FORECAST_CONFIG;
  const gap = forecast.bufferPaise - sf.closing.p50;
  const deadline = sf.week * 7 - 1;
  const custs = new Map(args.customers.map((c) => [c.id, c]));
  const cands: Candidate[] = [];

  for (const inv of args.invoices) {
    if (inv.disputed || inv.balancePaise <= 0) continue;
    const c = custs.get(inv.customerId);
    const name = c?.name ?? 'the customer';
    const label = inv.number ?? 'the invoice';
    const baseAtoms = arrivalAtoms(inv, today, models);
    const pBase = probPaidBy(baseAtoms, deadline);
    if (pBase >= 0.5) continue;
    const overdue = Math.max(0, daysBetween(inv.dueDate, today));
    const money = (n: number) => formatINR(paise(Math.round(n)));

    const pChase = probPaidBy(
      arrivalAtoms(inv, today, models, { chase: cfg.chaseFactor }),
      deadline,
    );
    const chaseCover = Math.round(inv.balancePaise * (pChase - pBase));
    if (chaseCover > 0) {
      cands.push({
        id: `chase:${inv.id}`,
        group: inv.id,
        kind: 'chase',
        cover: chaseCover,
        cost: 0,
        sentence: `Chase ${name} for ${label} (${money(inv.balancePaise)}${overdue ? `, ${overdue} days overdue` : ''}): free, expected to bring in about ${money(chaseCover)} in time.`,
      });
    }

    const discCover = Math.round(inv.balancePaise * (1 - pBase) * cfg.earlyDiscountTakeUp);
    cands.push({
      id: `discount:${inv.id}`,
      group: inv.id,
      kind: 'discount',
      cover: discCover,
      cost: Math.round((discCover * cfg.earlyDiscountPct) / 100),
      sentence: `Offer ${name} ${cfg.earlyDiscountPct}% off ${label} if they pay this week: costs about ${money((discCover * cfg.earlyDiscountPct) / 100)} and brings in about ${money(discCover)}.`,
    });

    if (c && cfg.tredsBuyers.includes(c.entityType ?? '')) {
      const median = quantile(
        baseAtoms.flatMap((a) =>
          Array<number>(Math.max(1, Math.round(a.weight * 100))).fill(a.offset),
        ),
        0.5,
      );
      const days = Math.min(120, Math.max(1, Math.round(median)));
      const fee = Math.round((inv.balancePaise * cfg.tredsAnnualRatePct * days) / 100 / 365);
      const cover = Math.round(inv.balancePaise * (1 - pBase)) - fee;
      if (cover > 0) {
        cands.push({
          id: `treds:${inv.id}`,
          group: inv.id,
          kind: 'treds',
          cover,
          cost: fee,
          sentence: `Sell ${label} (${name}) on TReDS: costs about ${money(fee)} (${cfg.tredsAnnualRatePct}% a year for about ${days} days) and brings in ${money(inv.balancePaise - fee)} now.`,
        });
      }
    }
  }

  const weekEnd = addDays(today, deadline);
  const nextWeek = addDays(weekEnd, 1);
  for (const o of args.occurrences) {
    if (!o.deferrable || o.date > weekEnd || o.date < today) continue;
    const days = Math.max(1, daysBetween(o.date, nextWeek));
    const fee = Math.round((o.amountPaise * cfg.deferFeePctPerMonth * days) / 100 / 30);
    cands.push({
      id: `defer:${o.expenseId}:${o.date}`,
      group: `bill:${o.expenseId}:${o.date}`,
      kind: 'defer',
      cover: o.amountPaise,
      cost: fee,
      sentence: `Ask to pay ${o.name} (${formatINR(paise(o.amountPaise))}, due ${o.date}) after ${weekEnd}: costs about ${formatINR(paise(fee))} in late charges and keeps the cash in the bank this week.`,
    });
  }

  const steps = selectActions(cands, gap).sort((a, b) => ratio(a) - ratio(b) || b.cover - a.cover);
  const { cover, cost } = totals(steps);
  const feasible = cover >= gap;
  const lead = `Week ${sf.week} (${sf.start} to ${sf.end}) is expected to end ${formatINR(paise(gap))} below your ${formatINR(paise(forecast.bufferPaise))} safety buffer.`;
  const summary = steps.length
    ? feasible
      ? `${lead} These steps cover it for about ${formatINR(paise(cost))} in total.`
      : `${lead} Even all the steps available cover only ${formatINR(paise(cover))}, so ${formatINR(paise(gap - cover))} is still short.`
    : `${lead} There is nothing here that can close the gap in time.`;
  return {
    week: sf.week,
    start: sf.start,
    end: sf.end,
    bufferPaise: forecast.bufferPaise,
    closingP50: sf.closing.p50,
    gapPaise: gap,
    steps,
    coveredPaise: cover,
    totalCostPaise: cost,
    feasible,
    summary,
  };
}
