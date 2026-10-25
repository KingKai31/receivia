import { describe, expect, it } from 'vitest';
import { NATIONAL_DEFAULTS, nationalImpact } from './national';

describe('nationalImpact', () => {
  it('default case', () => {
    const r = nationalImpact(NATIONAL_DEFAULTS);
    // 1,00,000 x Rs 10 lakh x 7.8/73
    expect(r.workingCapitalFreed / 100).toBeCloseTo((1e5 * 1e6 * 7.8) / 73, -2);
    expect(r.annualInterestSaved / r.workingCapitalFreed).toBeCloseTo(0.12, 4);
  });
  it('zero days or adopters frees nothing', () => {
    expect(nationalImpact({ ...NATIONAL_DEFAULTS, daysFaster: 0 }).workingCapitalFreed).toBe(0);
    expect(nationalImpact({ ...NATIONAL_DEFAULTS, adopters: 0 }).annualInterestSaved).toBe(0);
  });
  it('caps days at the baseline and clamps bad input', () => {
    const r = nationalImpact({ adopters: 10, receivablesRupees: 100, daysFaster: 500, borrowingRatePct: 12 });
    expect(r.releasedShare).toBe(1);
    expect(nationalImpact({ adopters: NaN, receivablesRupees: -5, daysFaster: -1, borrowingRatePct: NaN }).workingCapitalFreed).toBe(0);
  });
  it('is monotonic in days faster', () => {
    const a = nationalImpact({ ...NATIONAL_DEFAULTS, daysFaster: 5 }).workingCapitalFreed;
    const b = nationalImpact({ ...NATIONAL_DEFAULTS, daysFaster: 10 }).workingCapitalFreed;
    expect(b).toBeGreaterThan(a);
  });
});
