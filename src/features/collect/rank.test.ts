import { describe, expect, it } from 'vitest';
import type { ChaseItem } from '@/lib/forecast';
import { rankGroups, reasonByInvoice } from './rank';

const g = (name: string, ...ids: string[]) => ({
  name,
  items: ids.map((id) => ({ invoice: { id } })),
});
const c = (invoiceId: string, score: number): ChaseItem => ({
  invoiceId,
  customerId: 'x',
  customerName: 'x',
  balancePaise: 1,
  daysOverdue: 0,
  expectedPaise: 0,
  probBase: 0,
  probChased: 0,
  score,
  targetWeek: 1,
  reason: `r-${invoiceId}`,
});

describe('Collect ordering by chase priority', () => {
  it('highest best-score first; ties and unscored keep their order', () => {
    const groups = [g('A', 'a1'), g('B', 'b1', 'b2'), g('C', 'c1'), g('D', 'd1')];
    const out = rankGroups(groups, [c('a1', 10), c('b1', 5), c('b2', 50), c('c1', 10)]);
    expect(out.map((x) => x.name)).toEqual(['B', 'A', 'C', 'D']);
  });
  it('without any scores the original order stays', () => {
    const groups = [g('A', 'a1'), g('B', 'b1')];
    expect(rankGroups(groups, []).map((x) => x.name)).toEqual(['A', 'B']);
  });
  it('does not change the input array', () => {
    const groups = [g('A', 'a1'), g('B', 'b1')];
    rankGroups(groups, [c('b1', 9)]);
    expect(groups.map((x) => x.name)).toEqual(['A', 'B']);
  });
  it('maps reasons by invoice', () => {
    expect(reasonByInvoice([c('a1', 1)]).get('a1')).toBe('r-a1');
  });
});
