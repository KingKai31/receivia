import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  amountInWordsIndian,
  formatINR,
  formatINRShort,
  paise,
  parseRupees,
  roundToPaise,
} from './index';

describe('paise', () => {
  it('rejects non-integers and unsafe numbers', () => {
    expect(() => paise(1.5)).toThrow(MoneyError);
    expect(() => paise(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
    expect(() => paise(NaN)).toThrow(MoneyError);
  });
  it('roundToPaise rounds half away from zero', () => {
    expect(roundToPaise(2.5)).toBe(3);
    expect(roundToPaise(-2.5)).toBe(-3);
    expect(roundToPaise(2.4)).toBe(2);
  });
});

describe('parseRupees', () => {
  it.each([
    ['1,234.50', 123450],
    ['₹ 99', 9900],
    ['10.5', 1050],
    ['0.07', 7],
    ['1,18,000', 11800000],
    ['-5.25', -525],
    ['19.99', 1999],
  ])('%s -> %i', (s, n) => expect(parseRupees(s)).toBe(n));
  it.each(['', 'abc', '1.234', '1..2', '12.', '.5'])('rejects "%s"', (s) => {
    expect(() => parseRupees(s)).toThrow(MoneyError);
  });
  it('round-trips with formatINR for any paise', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 ** 12 }), (n) => {
        expect(parseRupees(formatINR(paise(n)))).toBe(n);
      }),
    );
  });
});

describe('formatting', () => {
  it('formatINR uses en-IN grouping with 2 decimals', () => {
    expect(formatINR(paise(11800000))).toBe('₹1,18,000.00');
    expect(formatINR(paise(5))).toBe('₹0.05');
    expect(formatINR(paise(-12345))).toBe('-₹123.45');
    expect(formatINR(paise(10_000_000_00))).toBe('₹1,00,00,000.00');
  });
  it('formatINRShort drops decimals only when whole', () => {
    expect(formatINRShort(paise(11800000))).toBe('₹1,18,000');
    expect(formatINRShort(paise(11800050))).toBe('₹1,18,000.50');
    expect(formatINRShort(paise(0))).toBe('₹0');
  });
});

describe('amountInWordsIndian', () => {
  it.each([
    [11800000, 'Rupees One Lakh Eighteen Thousand Only'],
    [0, 'Rupees Zero Only'],
    [100, 'Rupees One Only'],
    [10_000_000_00, 'Rupees One Crore Only'],
    [
      12_34_56_789_00,
      'Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only',
    ],
    [250_000, 'Rupees Two Thousand Five Hundred Only'],
    [12550, 'Rupees One Hundred Twenty Five and Fifty Paise Only'],
    [5, 'Rupees Zero and Five Paise Only'],
    [1_500_000_000_00, 'Rupees One Hundred Fifty Crore Only'],
  ])('%i', (n, words) => expect(amountInWordsIndian(paise(n))).toBe(words));
  it('rejects negatives', () => {
    expect(() => amountInWordsIndian(paise(-1))).toThrow(MoneyError);
  });
  it('never throws and always ends with Only for non-negative amounts', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 ** 13 }), (n) => {
        const w = amountInWordsIndian(paise(n));
        expect(w.startsWith('Rupees ')).toBe(true);
        expect(w.endsWith(' Only')).toBe(true);
      }),
    );
  });
});

describe('Indian grouping without Intl', () => {
  it('groups lakhs and crores', async () => {
    const { groupIndian } = await import('./paise');
    expect(groupIndian(0)).toBe('0');
    expect(groupIndian(999)).toBe('999');
    expect(groupIndian(1000)).toBe('1,000');
    expect(groupIndian(118000)).toBe('1,18,000');
    expect(groupIndian(1180000)).toBe('11,80,000');
    expect(groupIndian(123456789)).toBe('12,34,56,789');
  });
});
