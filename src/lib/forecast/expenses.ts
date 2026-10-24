import { addDays, type ISODate } from '@/lib/dates';
import type { Expense, Occurrence } from './types';

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds whole months, keeping the anchor's day (clamped to month end, so the 31st becomes the 30th). */
function addMonthsKeepDay(anchor: ISODate, months: number): ISODate {
  const y = Number(anchor.slice(0, 4));
  const m = Number(anchor.slice(5, 7));
  const d = Number(anchor.slice(8, 10));
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** Every date this expense falls due within [from, to], both inclusive. */
export function expenseDates(e: Expense, from: ISODate, to: ISODate): ISODate[] {
  if (!e.active) return [];
  const end = e.endsOn && e.endsOn < to ? e.endsOn : to;
  if (!e.isRecurring || !e.recurrence) {
    return e.expenseDate >= from && e.expenseDate <= end ? [e.expenseDate] : [];
  }
  const anchor = e.nextDue ?? e.expenseDate;
  const out: ISODate[] = [];
  if (e.recurrence === 'weekly') {
    let d = anchor;
    while (d < from) d = addDays(d, 7);
    for (; d <= end; d = addDays(d, 7)) out.push(d);
    return out;
  }
  const step = e.recurrence === 'monthly' ? 1 : e.recurrence === 'quarterly' ? 3 : 12;
  for (let i = 0; i < 400; i++) {
    const d = addMonthsKeepDay(anchor, i * step);
    if (d > end) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export function occurrences(expenses: Expense[], from: ISODate, to: ISODate): Occurrence[] {
  const out: Occurrence[] = [];
  for (const e of expenses) {
    for (const date of expenseDates(e, from, to)) {
      out.push({
        expenseId: e.id,
        name: e.name,
        date,
        amountPaise: e.amountPaise,
        deferrable: e.deferrable,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
