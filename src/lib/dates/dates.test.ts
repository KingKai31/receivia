import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DateError,
  addDays,
  daysBetween,
  fiscalYearOf,
  formatInvoiceNumber,
  istDateOf,
  setDemoDate,
  todayIST,
} from './index';

afterEach(() => setDemoDate(null));

describe('IST today', () => {
  it('rolls over at 18:30 UTC', () => {
    expect(istDateOf(new Date('2026-03-31T18:29:59Z'))).toBe('2026-03-31');
    expect(istDateOf(new Date('2026-03-31T18:30:00Z'))).toBe('2026-04-01');
  });
  it('demo date overrides the clock and can be cleared', () => {
    setDemoDate('2026-10-23');
    expect(todayIST(new Date('2030-01-01T00:00:00Z'))).toBe('2026-10-23');
    setDemoDate(null);
    expect(todayIST(new Date('2030-01-01T00:00:00Z'))).toBe('2030-01-01');
  });
  it('rejects a bad demo date', () => {
    expect(() => setDemoDate('2026-02-30')).toThrow(DateError);
  });
});

describe('financial year', () => {
  it('April to March', () => {
    expect(fiscalYearOf('2026-04-01').label).toBe('26-27');
    expect(fiscalYearOf('2027-03-31').label).toBe('26-27');
    expect(fiscalYearOf('2027-04-01').label).toBe('27-28');
    expect(fiscalYearOf('2026-03-31').label).toBe('25-26');
    expect(fiscalYearOf('2099-12-31').label).toBe('99-00');
    const fy = fiscalYearOf('2026-10-23');
    expect(fy.start).toBe('2026-04-01');
    expect(fy.end).toBe('2027-03-31');
  });
});

describe('daysBetween', () => {
  it('counts whole IST days', () => {
    expect(daysBetween('2026-10-01', '2026-10-23')).toBe(22);
    expect(daysBetween('2026-10-23', '2026-10-01')).toBe(-22);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });
  it('uses IST dates for instants, not elapsed hours', () => {
    // 23:00 IST on 1st and 01:00 IST on 2nd: 2 hours apart, 1 calendar day
    expect(daysBetween(new Date('2026-10-01T17:30:00Z'), new Date('2026-10-01T19:30:00Z'))).toBe(1);
  });
  it('is consistent with addDays', () => {
    fc.assert(
      fc.property(fc.integer({ min: -4000, max: 4000 }), (n) => {
        expect(daysBetween('2026-10-23', addDays('2026-10-23', n))).toBe(n);
      }),
    );
  });
  it('rejects invalid dates', () => {
    expect(() => daysBetween('2026-13-01', '2026-01-01')).toThrow(DateError);
  });
});

describe('invoice number', () => {
  it('formats INV/26-27/0001 and stays within 16 chars', () => {
    expect(formatInvoiceNumber('INV', '26-27', 1)).toBe('INV/26-27/0001');
    expect(formatInvoiceNumber('ABCD', '26-27', 99999)).toHaveLength(16);
  });
  it('rejects bad prefix or sequence', () => {
    expect(() => formatInvoiceNumber('inv', '26-27', 1)).toThrow(DateError);
    expect(() => formatInvoiceNumber('ABCDE', '26-27', 1)).toThrow(DateError);
    expect(() => formatInvoiceNumber('INV', '26-27', 0)).toThrow(DateError);
  });
});
