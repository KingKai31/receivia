import { describe, expect, it } from 'vitest';
import { certificateRequestText, match26as, parse26as, summarizeTds, type TdsRow } from './index';

const row = (o: Partial<TdsRow>): TdsRow => ({
  id: 'e1',
  customerId: 'c1',
  customerName: 'Delta Services LLP',
  section: '194C',
  amountPaise: 400000,
  deductedOn: '2026-10-06',
  certificateStatus: 'pending',
  claimedIn26as: false,
  ...o,
});

describe('TDS ledger', () => {
  it('groups deducted, received and claimed per customer per quarter', () => {
    const s = summarizeTds([
      row({ id: 'a' }),
      row({ id: 'b', amountPaise: 100000, certificateStatus: 'received', claimedIn26as: true }),
      row({ id: 'c', deductedOn: '2026-05-10', amountPaise: 50000 }),
      row({
        id: 'd',
        customerId: 'c2',
        customerName: 'Gamma',
        amountPaise: 1000,
        certificateStatus: 'not_applicable',
      }),
    ]);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({
      quarter: '26-27 Q3',
      deductedPaise: 500000,
      receivedPaise: 100000,
      claimedPaise: 100000,
      openIds: ['a'],
    });
    expect(s[1]).toMatchObject({ quarter: '26-27 Q1', deductedPaise: 50000 });
  });
  it('writes a certificate request that names the amount and quarter', () => {
    const t = certificateRequestText({
      customer: 'Delta',
      quarter: '26-27 Q3',
      amountPaise: 400000,
      business: 'Demo Traders',
      contact: '9820000000',
    });
    expect(t).toContain('₹4,000.00');
    expect(t).toContain('26-27 Q3');
    expect(t).toContain('Form 16A');
  });
  it('parses a 26AS CSV and ticks matching entries once each', () => {
    const csv =
      'Name of Deductor,Section,Amount Paid,Tax Deducted,Date of Booking\n"DELTA SERVICES LLP",194C,"2,00,000.00","4,000.00",30/10/2026\n"Delta Services LLP",194C,"2,00,000.00","4,000.00",30/10/2026\n"Unknown Co",194J,"1,000.00","100.00",01/11/2026\n';
    const p = parse26as(csv);
    expect(p.errors).toEqual([]);
    expect(p.rows[0]).toMatchObject({ section: '194C', amountPaise: 400000 });
    const m = match26as(p.rows, [row({ id: 'a' }), row({ id: 'b', amountPaise: 400050 })]);
    expect(m.matched.map((x) => x.entryId)).toEqual(['a', 'b']);
    expect(m.unmatched).toHaveLength(1);
    const once = match26as(p.rows, [row({ id: 'a' })]);
    expect(once.matched).toHaveLength(1);
    expect(once.unmatched).toHaveLength(2);
  });
  it('does not tick an entry already claimed, or a different section/amount', () => {
    const p = parse26as(
      'Name of Deductor,Section,Tax Deducted\nDelta Services,194J,"4,000.00"\nDelta Services,194C,"9,000.00"\n',
    );
    const m = match26as(p.rows, [row({ id: 'a' })]);
    expect(m.matched).toHaveLength(0);
    const claimed = match26as(
      parse26as('Name of Deductor,Section,Tax Deducted\nDelta Services,194C,"4,000.00"\n').rows,
      [row({ id: 'a', claimedIn26as: true })],
    );
    expect(claimed.matched).toHaveLength(0);
  });
  it('reports a file without the needed columns', () => {
    expect(parse26as('a,b\n1,2').errors[0]).toMatch(/deductor/i);
  });
});
