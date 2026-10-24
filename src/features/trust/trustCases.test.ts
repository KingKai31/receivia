import { describe, expect, it } from 'vitest';
import { runTrustCases } from './trustCases';

describe('trust page cases', () => {
  const results = runTrustCases();
  it('covers GST, GSTIN, amount in words, ladder, matching and forecast', () => {
    expect([...new Set(results.map((r) => r.group))]).toEqual([
      'GST',
      'GSTIN',
      'Amount in words',
      'Ladder',
      'Matching',
      'Forecast',
    ]);
  });
  it.each(results.map((r) => [r.group, r.name, r] as const))('%s: %s', (_g, _n, r) => {
    expect(r.actual).toBe(r.expected);
    expect(r.pass).toBe(true);
  });
});
