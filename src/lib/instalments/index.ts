import { addDays, daysBetween, type ISODate } from '@/lib/dates';

/** Mirrors the limits inside public.pay_extra (migration 0012). */
export const INSTALMENT_CONFIG = {
  minCount: 2,
  maxCount: 4,
  maxDaysAhead: 90,
  minGapDays: 7,
} as const;

export interface Instalment {
  date: ISODate;
  amount_paise: number;
}

/** Splits the balance evenly; the remainder goes to the first instalments, one paisa each. */
export function splitEvenly(balance: number, count: number, today: ISODate): Instalment[] {
  const n = Math.min(Math.max(count, INSTALMENT_CONFIG.minCount), INSTALMENT_CONFIG.maxCount);
  const base = Math.floor(balance / n);
  const extra = balance - base * n;
  const gap = Math.max(
    INSTALMENT_CONFIG.minGapDays,
    Math.floor(INSTALMENT_CONFIG.maxDaysAhead / n / 7) * 7,
  );
  return Array.from({ length: n }, (_, i) => ({
    date: addDays(today, gap * (i + 1)),
    amount_paise: base + (i < extra ? 1 : 0),
  }));
}

/** Returns a list of problems; empty means the plan is valid. */
export function validatePlan(items: Instalment[], balance: number, today: ISODate): string[] {
  const c = INSTALMENT_CONFIG;
  const errs: string[] = [];
  if (items.length < c.minCount || items.length > c.maxCount)
    errs.push(`Choose ${c.minCount} to ${c.maxCount} instalments.`);
  let sum = 0;
  items.forEach((it, i) => {
    sum += it.amount_paise;
    if (!Number.isSafeInteger(it.amount_paise) || it.amount_paise <= 0)
      errs.push(`Instalment ${i + 1}: amount must be above zero.`);
    const d = daysBetween(today, it.date);
    if (d < 0 || d > c.maxDaysAhead)
      errs.push(`Instalment ${i + 1}: date must be within ${c.maxDaysAhead} days.`);
    if (i > 0 && daysBetween(items[i - 1]!.date, it.date) < c.minGapDays)
      errs.push(`Instalment ${i + 1}: at least ${c.minGapDays} days after the previous one.`);
  });
  if (sum !== balance) errs.push('Instalments must add up to the balance.');
  return errs;
}
