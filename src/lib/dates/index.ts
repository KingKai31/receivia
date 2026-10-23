/** Dates are plain 'YYYY-MM-DD' strings in IST. Business logic never uses the browser timezone. */
export type ISODate = string;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

let demoDate: ISODate | null = null;

/** Pins "today" for the demo and tests. Pass null to return to the real clock. */
export function setDemoDate(date: ISODate | null): void {
  if (date !== null) assertISODate(date);
  demoDate = date;
}

export function getDemoDate(): ISODate | null {
  return demoDate;
}

export class DateError extends Error {
  readonly code = 'INVALID_DATE';
  constructor(message: string) {
    super(message);
    this.name = 'DateError';
  }
}

function toUtcMs(date: ISODate): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new DateError(`Not a YYYY-MM-DD date: "${date}"`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new DateError(`Not a real calendar date: "${date}"`);
  }
  return ms;
}

export function assertISODate(date: string): ISODate {
  toUtcMs(date);
  return date;
}

/** The IST calendar date of an instant. */
export function istDateOf(instant: Date): ISODate {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today in IST, honouring the demo-date override. */
export function todayIST(now: Date = new Date()): ISODate {
  return demoDate ?? istDateOf(now);
}

export interface FinancialYear {
  /** Calendar year in which the FY starts (April). */
  startYear: number;
  /** e.g. '26-27' */
  label: string;
  start: ISODate;
  end: ISODate;
}

/** Indian FY runs April to March. */
export function fiscalYearOf(date: ISODate): FinancialYear {
  const ms = toUtcMs(date);
  const d = new Date(ms);
  const startYear = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  return {
    startYear,
    label: `${yy(startYear)}-${yy(startYear + 1)}`,
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

/** Whole IST days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: ISODate | Date, to: ISODate | Date): number {
  const a = typeof from === 'string' ? from : istDateOf(from);
  const b = typeof to === 'string' ? to : istDateOf(to);
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

export function addDays(date: ISODate, days: number): ISODate {
  return new Date(toUtcMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Invoice number like INV/26-27/0001. Prefix: 1-4 chars A-Z0-9 so the whole number stays ≤ 16. */
export function formatInvoiceNumber(prefix: string, fyLabel: string, seq: number): string {
  if (!/^[A-Z0-9]{1,4}$/.test(prefix)) throw new DateError(`Bad invoice prefix: "${prefix}"`);
  if (!Number.isInteger(seq) || seq < 1 || seq > 99999) throw new DateError(`Bad sequence: ${seq}`);
  return `${prefix}/${fyLabel}/${String(seq).padStart(4, '0')}`;
}
