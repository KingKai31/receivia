import { daysBetween, type ISODate } from '@/lib/dates';
import { formatINR, paise } from '@/lib/money';
import { arrivalAtoms, probPaidBy } from './arrival';
import { FORECAST_CONFIG } from './config';
import { modelFor } from './delay';
import { firstShortfall } from './simulate';
import type { CustomerInfo, DelayModels, Forecast, OpenInvoice } from './types';

export interface ChaseItem {
  invoiceId: string;
  customerId: string;
  customerName: string;
  balancePaise: number;
  daysOverdue: number;
  /** Expected paise this invoice brings in by the end of the target week if chased now. */
  expectedPaise: number;
  /** Probability it is paid by then if we do nothing / if we chase now. */
  probBase: number;
  probChased: number;
  score: number;
  targetWeek: number;
  reason: string;
}

function lateText(median: number, n: number): string {
  if (n === 0) return 'no payment history yet';
  const r = Math.round(median);
  if (r === 0) return 'usually pays on the due date';
  if (r < 0) return `usually pays ${-r} days early`;
  return `usually pays ${r} days late`;
}

/**
 * Chase priority. score = expected rupees brought in by the end of the first shortfall week if the
 * invoice is chased now (balance x P(paid by then | chased)), x (1 + days overdue / 120, capped at 2)
 * x a reliability weight (A 1, B 0.85, C 0.65). With no shortfall, week 4 is the target.
 */
export function chaseScores(args: {
  today: ISODate;
  forecast: Forecast;
  invoices: OpenInvoice[];
  customers: CustomerInfo[];
  models: DelayModels;
}): ChaseItem[] {
  const { today, forecast, models } = args;
  const sf = firstShortfall(forecast);
  const week = sf ? sf.week : FORECAST_CONFIG.noShortfallTargetWeek;
  const gap = sf ? forecast.bufferPaise - sf.closing.p50 : 0;
  const deadline = week * 7 - 1;
  const names = new Map(args.customers.map((c) => [c.id, c.name]));
  const items: ChaseItem[] = [];
  for (const inv of args.invoices) {
    if (inv.balancePaise <= 0) continue;
    const overdue = Math.max(0, daysBetween(inv.dueDate, today));
    const model = modelFor(models, inv.customerId);
    const base = probPaidBy(arrivalAtoms(inv, today, models), deadline);
    const chased = probPaidBy(
      arrivalAtoms(inv, today, models, { chase: FORECAST_CONFIG.chaseFactor }),
      deadline,
    );
    const expected = inv.disputed ? 0 : Math.round(inv.balancePaise * chased);
    const score =
      expected *
      (1 + Math.min(overdue, 120) / 120) *
      (FORECAST_CONFIG.gradeWeight[model.grade] ?? 1);
    const parts = [
      formatINR(paise(inv.balancePaise)),
      overdue > 0
        ? `${overdue} days overdue`
        : `due in ${Math.max(0, daysBetween(today, inv.dueDate))} days`,
      lateText(model.median, model.n),
    ];
    if (inv.disputed) parts.push('in dispute, so it is not counted until resolved');
    else if (sf) {
      parts.push(
        expected >= gap
          ? `covers the shortfall in week ${week}`
          : `covers ${gap > 0 ? Math.round((expected / gap) * 100) : 0}% of the week ${week} shortfall`,
      );
    } else {
      parts.push(`expected to bring in ${formatINR(paise(expected))} by week ${week}`);
    }
    items.push({
      invoiceId: inv.id,
      customerId: inv.customerId,
      customerName: names.get(inv.customerId) ?? 'Customer',
      balancePaise: inv.balancePaise,
      daysOverdue: overdue,
      expectedPaise: expected,
      probBase: base,
      probChased: chased,
      score,
      targetWeek: week,
      reason: parts.join(', '),
    });
  }
  return items.sort(
    (a, b) =>
      b.score - a.score ||
      b.balancePaise - a.balancePaise ||
      a.invoiceId.localeCompare(b.invoiceId),
  );
}

/** Best score per customer, for ordering the Collect page. */
export function scoreByCustomer(items: ChaseItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.customerId, Math.max(m.get(i.customerId) ?? 0, i.score));
  return m;
}
