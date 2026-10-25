import { addDays, daysBetween, type ISODate } from '@/lib/dates';
import { IMPACT_CONFIG, type ImpactConfig } from './config';

/** One invoice in the replay window. Amounts are integer paise. */
export interface ReplayInvoice {
  id: string;
  issueDate: ISODate;
  dueDate: ISODate;
  totalPaise: number;
  /** Date it was fully paid, or null if still unpaid on `asOf`. */
  paidOn: ISODate | null;
  /** Days it sat in a dispute or payability hold. */
  holdDays?: number;
  /** Days between a promised date and the actual payment, when the promise was missed. */
  promiseSlipDays?: number;
}

export interface ReplayInput {
  asOf: ISODate;
  invoices: ReplayInvoice[];
  /** Money out by date (expenses) within the window. */
  outflows: { date: ISODate; amountPaise: number }[];
  /** Bank balance on `asOf`; the start balance is worked back from it. */
  endingBalancePaise: number;
  bufferPaise: number;
  config?: ImpactConfig;
}

export interface ReplayMetrics {
  /** Mean days from issue to payment over invoices paid. */
  avgDaysToCollect: number;
  /** Overdue amount at each month end in the window (oldest first). */
  overdueAtMonthEnd: { monthEnd: ISODate; overduePaise: number }[];
  /** Overdue amount on the latest month end. */
  overdueLatestPaise: number;
  /** Weeks whose closing balance fell below the safety buffer. */
  shortfallWeeks: number;
  weeks: number;
  collectedPaise: number;
}

export interface ReplayResult {
  from: ISODate;
  to: ISODate;
  invoicesPaid: number;
  asHappened: ReplayMetrics;
  withReceivia: ReplayMetrics;
  /** Days earlier cash arrived, summed over invoices. */
  daysSaved: number;
  avgDaysSaved: number;
  shortfallWeeksAvoided: number;
  overdueReducedPaise: number;
  /** Total of invoices that were paid at least a day sooner. */
  amountPulledForwardPaise: number;
  /** Sum of amount x days saved, in paise-days. */
  paiseDaysSaved: number;
  borrowingCostAvoidedPaise: number;
}

/** Days an invoice is paid late after Receivia's rules. Never later than what happened. */
export function receiviaLateDays(
  inv: Pick<ReplayInvoice, 'dueDate' | 'paidOn' | 'holdDays' | 'promiseSlipDays'>,
  cfg: ImpactConfig = IMPACT_CONFIG,
): number {
  if (!inv.paidOn) return 0;
  const late = daysBetween(inv.dueDate, inv.paidOn);
  if (late <= 0) return late;
  // 1. A dispute or hold is fixed up front; friendly reminders pull the rest in.
  const held = Math.min(Math.max(inv.holdDays ?? 0, 0), late);
  let l = (late - held * cfg.payabilityFixShare) * (1 - cfg.friendlyNudgeShare);
  // 2. Reminder stages: after the latest stage that falls before payment, the remaining wait shrinks.
  let k: string | null = null;
  for (const [stage, day] of Object.entries(cfg.stageDays)) {
    if (day < l && (k === null || day > cfg.stageDays[k]!)) k = stage;
  }
  if (k) {
    const t = cfg.stageDays[k]!;
    l = t + (l - t) * (cfg.stageFactor[k] ?? 1);
  }
  // 3. Promise tracking recovers part of a missed promise.
  const slip = Math.min(Math.max(inv.promiseSlipDays ?? 0, 0), l);
  l -= slip * cfg.promiseSlipRecovery;
  return Math.min(Math.max(Math.round(l), 0), late);
}

function monthEnds(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (;;) {
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (last > to) break;
    if (last >= from) out.push(last);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function metrics(
  invs: ReplayInvoice[],
  paidOn: (i: ReplayInvoice) => ISODate | null,
  input: ReplayInput,
  from: ISODate,
  startBalance: number,
): ReplayMetrics {
  const to = input.asOf;
  const paid = invs.filter((i) => paidOn(i));
  const avg = paid.length
    ? paid.reduce((s, i) => s + daysBetween(i.issueDate, paidOn(i)!), 0) / paid.length
    : 0;
  const overdueAt = (d: ISODate) =>
    invs.reduce((s, i) => {
      const p = paidOn(i);
      const open = i.issueDate <= d && (!p || p > d);
      return open && i.dueDate < d ? s + i.totalPaise : s;
    }, 0);
  const ends = monthEnds(from, to).map((monthEnd) => ({
    monthEnd,
    overduePaise: overdueAt(monthEnd),
  }));
  const weeks = Math.max(1, Math.floor((daysBetween(from, to) + 1) / 7));
  let bal = startBalance;
  let short = 0;
  for (let w = 0; w < weeks; w++) {
    const a = addDays(from, w * 7);
    const b = addDays(a, 6);
    const inn = paid.reduce((s, i) => {
      const p = paidOn(i)!;
      return p >= a && p <= b ? s + i.totalPaise : s;
    }, 0);
    const out = input.outflows.reduce(
      (s, o) => (o.date >= a && o.date <= b ? s + o.amountPaise : s),
      0,
    );
    bal += inn - out;
    if (bal < input.bufferPaise) short++;
  }
  const collected = paid.reduce((s, i) => (paidOn(i)! >= from ? s + i.totalPaise : s), 0);
  return {
    avgDaysToCollect: Math.round(avg * 10) / 10,
    overdueAtMonthEnd: ends,
    overdueLatestPaise: ends.at(-1)?.overduePaise ?? 0,
    shortfallWeeks: short,
    weeks,
    collectedPaise: collected,
  };
}

/**
 * Replays the last months twice over the same invoices: as it happened, and with Receivia's rules.
 * Pure and deterministic. The start balance is worked back from today's balance using what
 * happened, so both runs begin from the same cash.
 */
export function replayImpact(input: ReplayInput): ReplayResult {
  const cfg = input.config ?? IMPACT_CONFIG;
  const from = addDays(input.asOf, -Math.round(cfg.months * 30.4) + 1);
  const invs = input.invoices.filter(
    (i) => i.issueDate <= input.asOf && (i.paidOn === null || i.paidOn >= from),
  );
  const actual = (i: ReplayInvoice) => i.paidOn;
  const better = (i: ReplayInvoice): ISODate | null => {
    if (!i.paidOn) return null;
    const late = daysBetween(i.dueDate, i.paidOn);
    return late <= 0 ? i.paidOn : addDays(i.dueDate, receiviaLateDays(i, cfg));
  };
  const inWindowIn = invs
    .filter((i) => i.paidOn && i.paidOn >= from && i.paidOn <= input.asOf)
    .reduce((s, i) => s + i.totalPaise, 0);
  const outAll = input.outflows
    .filter((o) => o.date >= from && o.date <= input.asOf)
    .reduce((s, o) => s + o.amountPaise, 0);
  const startBalance = input.endingBalancePaise - inWindowIn + outAll;
  const happened = metrics(invs, actual, input, from, startBalance);
  const withR = metrics(invs, better, input, from, startBalance);

  let daysSavedTotal = 0;
  let paiseDays = 0;
  let n = 0;
  let pulled = 0;
  for (const i of invs) {
    if (!i.paidOn) continue;
    const d = daysBetween(better(i)!, i.paidOn);
    daysSavedTotal += d;
    paiseDays += d * i.totalPaise;
    if (d > 0) pulled += i.totalPaise;
    n++;
  }
  return {
    from,
    to: input.asOf,
    invoicesPaid: n,
    asHappened: happened,
    withReceivia: withR,
    daysSaved: daysSavedTotal,
    avgDaysSaved: n ? Math.round((daysSavedTotal / n) * 10) / 10 : 0,
    shortfallWeeksAvoided: Math.max(happened.shortfallWeeks - withR.shortfallWeeks, 0),
    overdueReducedPaise: Math.max(happened.overdueLatestPaise - withR.overdueLatestPaise, 0),
    amountPulledForwardPaise: pulled,
    paiseDaysSaved: paiseDays,
    borrowingCostAvoidedPaise: Math.round((paiseDays * cfg.borrowingRatePct) / 100 / 365),
  };
}
