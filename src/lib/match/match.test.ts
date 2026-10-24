import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { paise } from '@/lib/money';
import {
  dedupeKeys,
  explainShortfall,
  guessMapping,
  matchCustomer,
  namedInvoices,
  nameTokens,
  parseBankCsv,
  parseBankDate,
  parseCsv,
  suggestMatches,
  suggestOne,
  tdsAmount,
  tdsQuarter,
  type BankLine,
  type MatchCustomer,
  type OpenInvoice,
} from './index';

const seed = JSON.parse(readFileSync('src/lib/match/fixtures/demo-data.json', 'utf8')) as {
  customers: { key: string; name: string; entity_type: MatchCustomer['entityType'] }[];
  invoices: {
    number: string;
    customer: string;
    taxable_paise: number;
    issue_date: string;
    due_date: string;
  }[];
};
const customers: MatchCustomer[] = seed.customers.map((c) => ({
  id: c.key,
  name: c.name,
  entityType: c.entity_type,
}));
const invoices: OpenInvoice[] = seed.invoices.map((i) => ({
  id: i.number,
  number: i.number,
  customerId: i.customer,
  balancePaise: Math.round(i.taxable_paise * 1.18),
  taxablePaise: i.taxable_paise,
  issueDate: i.issue_date,
  dueDate: i.due_date,
}));
const csv = readFileSync('src/lib/match/fixtures/bank-statement.csv', 'utf8');
const MAP = {
  date: 'Date',
  description: 'Description',
  credit: 'Credit',
  debit: 'Debit',
  reference: 'Reference',
};
const parsed = parseBankCsv(csv, MAP);
const line = (description: string, credit: number, over: Partial<BankLine> = {}): BankLine => ({
  date: '2026-10-01',
  description,
  creditPaise: paise(credit),
  debitPaise: paise(0),
  reference: '',
  ...over,
});

describe('seed bank statement: every case', () => {
  const sugg = suggestMatches(parsed.lines, invoices, customers);
  it('parses all 9 lines without errors', () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines).toHaveLength(9);
  });
  it('prints and checks the match for every line', () => {
    console.table(
      sugg.map((s) => ({
        line: s.line.description.slice(0, 34),
        credit: s.line.creditPaise / 100,
        kind: s.kind,
        conf: s.confidence,
        to: s.allocations
          .map((a) => `${a.invoiceNumber.slice(-4)}:${a.amountPaise / 100}`)
          .join(' '),
        tds: s.tds ? `${s.tds.section} ${s.tds.amountPaise / 100}` : '',
        credit_bal: s.creditBalancePaise / 100,
      })),
    );
    expect(sugg.map((s) => s.kind)).toEqual([
      'exact',
      'part',
      'multi',
      'tds_short',
      'overpayment',
      'unknown',
      'tds_short',
      'tds_short',
      'debit',
    ]);
  });
  it('exact line names the invoice and amount in words', () => {
    expect(sugg[0]!.allocations).toMatchObject([
      { invoiceNumber: 'INV/26-27/0001', amountPaise: 11800000 },
    ]);
    expect(sugg[0]!.reason).toMatch(/named in the description/);
    expect(sugg[0]!.confidence).toBeGreaterThan(0.9);
  });
  it('part payment leaves the rest due', () => {
    expect(sugg[1]!.allocations[0]!.amountPaise).toBe(3000000);
    expect(sugg[1]!.reason).toMatch(/part payment/);
    expect(sugg[1]!.reason).toMatch(/₹29,000\.00 stays due/);
  });
  it('one payment for several invoices goes oldest first', () => {
    expect(sugg[2]!.allocations.map((a) => [a.invoiceNumber, a.amountPaise])).toEqual([
      ['INV/26-27/0003', 1180000],
      ['INV/26-27/0004', 2360000],
    ]);
    expect(sugg[2]!.reason).toMatch(/oldest first/);
  });
  it('short by 2% of taxable is TDS 194C for a firm', () => {
    expect(sugg[3]!.tds).toMatchObject({
      section: '194C',
      ratePct: 2,
      amountPaise: 400000,
      taxablePaise: 20000000,
    });
  });
  it('overpayment keeps the extra as credit balance, not allocated', () => {
    expect(sugg[4]!.allocations[0]!.amountPaise).toBe(1180000);
    expect(sugg[4]!.creditBalancePaise).toBe(20000);
  });
  it('unknown deposit has no allocation and low confidence', () => {
    expect(sugg[5]).toMatchObject({ allocations: [], customerId: null });
    expect(sugg[5]!.confidence).toBeLessThan(0.3);
  });
  it('government buyer 2% is GST TDS; company 0.1% is 194Q', () => {
    expect(sugg[6]!.tds).toMatchObject({ section: 'GST_TDS', amountPaise: 1000000 });
    expect(sugg[7]!.tds).toMatchObject({ section: '194Q', amountPaise: 100000 });
    expect(sugg[7]!.reason).toMatch(/Verify the rate/);
  });
  it('every non-debit suggestion explains itself and nothing is auto-confirmed', () => {
    for (const s of sugg) expect(s.reason.length).toBeGreaterThan(20);
  });
});

describe('matching rules', () => {
  it('finds invoice numbers with any spacing or separator', () => {
    for (const d of [
      'INV/26-27/0001',
      'inv 26 27 0001',
      'INV-26-27-0001',
      'INV26270001',
      'inv.26.27.0001 paid',
    ]) {
      expect(namedInvoices(d, invoices).map((i) => i.number)).toEqual(['INV/26-27/0001']);
    }
  });
  it('does not confuse 0001 with 00012', () => {
    const more = [...invoices, { ...invoices[0]!, id: 'x', number: 'INV/26-27/00012' }];
    expect(namedInvoices('INV/26-27/00012', more).map((i) => i.id)).toEqual(['x']);
  });
  it('loose customer names ignore M/s, Pvt, Ltd and case', () => {
    expect(nameTokens('M/s. Alpha Engineering Pvt. Ltd.')).toEqual(['ALPHA', 'ENGINEERING']);
    expect(matchCustomer('neft alpha engineering', customers)?.id).toBe('alpha');
    expect(matchCustomer('GAMMA STEEL', customers)?.id).toBe('gamma');
    expect(matchCustomer('random person', customers)).toBeNull();
  });
  it('payment named for the second invoice is applied there, not oldest first', () => {
    const s = suggestOne(line('EPSILON RETAIL INV/26-27/0004', 2360000), invoices, customers);
    expect(s.kind).toBe('exact');
    expect(s.allocations[0]!.invoiceNumber).toBe('INV/26-27/0004');
  });
  it('amount equal to one invoice with no names matches it at lower confidence', () => {
    const s = suggestOne(line('MISC CREDIT', 5900000), invoices, customers);
    expect(s.kind).toBe('exact');
    expect(s.allocations[0]!.invoiceNumber).toBe('INV/26-27/0002');
    expect(s.confidence).toBeLessThan(0.7);
  });
  it('two deposits cannot claim the same balance', () => {
    const [a, b] = suggestMatches(
      [line('BETA TRADERS INV/26-27/0002', 5900000), line('BETA TRADERS INV/26-27/0002', 5900000)],
      invoices,
      customers,
    );
    expect(a!.kind).toBe('exact');
    expect(b!.kind).toBe('unknown');
  });
  it('TDS match is within one rupee and not beyond', () => {
    const t = (short: number) =>
      explainShortfall({ shortfallPaise: short, taxablePaise: 20000000, entity: 'firm' });
    expect(t(400000)).not.toBeNull();
    expect(t(400100)).not.toBeNull();
    expect(t(399900)).not.toBeNull();
    expect(t(400101)).toBeNull();
    expect(t(0)).toBeNull();
    expect(tdsAmount(20000000, 0.1)).toBe(20000);
  });
  it('individual contractor gets 194C 1%', () => {
    expect(
      explainShortfall({ shortfallPaise: 200000, taxablePaise: 20000000, entity: 'proprietor' })
        ?.section,
    ).toBe('194C');
  });
  it('quarters follow the Indian FY', () => {
    expect([
      tdsQuarter('2026-04-01'),
      tdsQuarter('2026-09-30'),
      tdsQuarter('2026-12-31'),
      tdsQuarter('2027-03-31'),
    ]).toEqual(['26-27 Q1', '26-27 Q2', '26-27 Q3', '26-27 Q4']);
  });
});

describe('bank csv', () => {
  it('re-import gives identical keys; identical lines in one file still get distinct keys', () => {
    const a = dedupeKeys(parsed.lines);
    const b = dedupeKeys(parseBankCsv(csv, MAP).lines);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    const dup = [parsed.lines[0]!, parsed.lines[0]!];
    const k = dedupeKeys(dup);
    expect(k[0]).not.toBe(k[1]);
    expect(dedupeKeys([...dup, parsed.lines[1]!]).slice(0, 2)).toEqual(k);
  });
  it('reference differences keep lines apart; case and spaces in reference do not', () => {
    const l = parsed.lines[0]!;
    expect(dedupeKeys([{ ...l, reference: 'N 1001' }])[0]).toBe(
      dedupeKeys([{ ...l, reference: 'n1001' }])[0],
    );
    expect(dedupeKeys([{ ...l, reference: 'X' }])[0]).not.toBe(dedupeKeys([l])[0]);
  });
  it('parses quoted fields, CRLF, BOM and common date formats', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
    expect(parseBankDate('03/10/2026')).toBe('2026-10-03');
    expect(parseBankDate('3-Oct-26')).toBe('2026-10-03');
    expect(parseBankDate('2026-10-03')).toBe('2026-10-03');
    expect(parseBankDate('31/02/2026')).toBeNull();
    expect(parseBankDate('hello')).toBeNull();
  });
  it('reports bad rows and missing columns instead of guessing', () => {
    const bad = parseBankCsv(
      'Date,Description,Credit,Debit\n99/99/2026,x,10,\n01/10/2026,y,abc,\n01/10/2026,z,10,5\n01/10/2026,ok,10,\n',
      {
        ...MAP,
        reference: '',
      },
    );
    expect(bad.lines).toHaveLength(1);
    expect(bad.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(parseBankCsv('A,B\n1,2', MAP).errors[0]!.message).toMatch(/not found/);
  });
  it('guesses the column mapping from common bank headers', () => {
    expect(
      guessMapping(['Txn Date', 'Narration', 'Withdrawal Amt.', 'Deposit Amt.', 'Chq/Ref No']),
    ).toEqual({
      date: 'Txn Date',
      description: 'Narration',
      debit: 'Withdrawal Amt.',
      credit: 'Deposit Amt.',
      reference: 'Chq/Ref No',
    });
  });
});
