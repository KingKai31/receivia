import { MoneyError } from './errors';

declare const paiseBrand: unique symbol;
/** Integer paise. The only money representation used across the app. */
export type Paise = number & { readonly [paiseBrand]: true };

export function paise(n: number): Paise {
  if (!Number.isSafeInteger(n)) {
    throw new MoneyError('NOT_SAFE_INTEGER', `Paise must be a safe integer, got ${n}`);
  }
  return n as Paise;
}

/** Round a possibly fractional paise amount to the nearest paisa (half away from zero). */
export function roundToPaise(n: number): Paise {
  return paise(n < 0 ? -Math.round(-n) : Math.round(n));
}

/**
 * Parse typed rupees ("1,234.50", "₹ 99", "10.5") into paise. Done once at the input boundary,
 * by string arithmetic so no float error creeps in. At most 2 decimals.
 */
export function parseRupees(input: string): Paise {
  const cleaned = input.replace(/[₹,\s]/g, '');
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) throw new MoneyError('INVALID_RUPEES', `Not a valid rupee amount: "${input}"`);
  const [, neg, whole, frac = ''] = m;
  const total = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(total)) {
    throw new MoneyError('NOT_SAFE_INTEGER', `Amount too large: "${input}"`);
  }
  return paise(neg ? -total : total);
}

/** Indian digit grouping (1,18,000) without Intl: some runtimes (edge functions) ship without en-IN data. */
export function groupIndian(n: number): string {
  const s = String(Math.trunc(n));
  if (s.length <= 3) return s;
  const head = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${s.slice(-3)}`;
}
const inr = { format: groupIndian };

function split(p: Paise): { sign: string; rupees: number; rem: number } {
  const abs = Math.abs(p);
  return { sign: p < 0 ? '-' : '', rupees: Math.floor(abs / 100), rem: abs % 100 };
}

/** Documents: always 2 decimals, e.g. ₹1,18,000.00 */
export function formatINR(p: Paise): string {
  const { sign, rupees, rem } = split(p);
  return `${sign}₹${inr.format(rupees)}.${String(rem).padStart(2, '0')}`;
}

/** UI tiles: no decimals when whole rupees, else 2 decimals. */
export function formatINRShort(p: Paise): string {
  const { sign, rupees, rem } = split(p);
  return rem === 0
    ? `${sign}₹${inr.format(rupees)}`
    : `${sign}₹${inr.format(rupees)}.${String(rem).padStart(2, '0')}`;
}
