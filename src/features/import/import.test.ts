import { describe, expect, it } from 'vitest';
import { fakeClient, type FakeCall } from '@/lib/service/testing';
import { generateGstin } from '@/lib/gstin';
import {
  CUSTOMER_FIELDS,
  INVOICE_FIELDS,
  applyMapping,
  guessMapping,
  missingRequired,
  normaliseDate,
  readSheet,
  summarise,
  validateCustomerRows,
  validateInvoiceRows,
} from './importCore';
import { commitInvoices } from './importService';
import { parseTallyXml } from './tally';

const ctx = (over = {}) => ({
  supplierStateCode: '27',
  existingNumbers: new Set<string>(),
  customerStates: new Map<string, string | null>(),
  ...over,
});

function invoiceCsv(n: number, badRows: Record<number, Partial<Record<string, string>>> = {}) {
  const gst = [generateGstin('27'), generateGstin('29'), generateGstin('24')];
  const lines = [
    'Invoice No,Invoice Date,Customer,Customer GSTIN,Taxable Value,CGST,SGST,IGST,Total',
  ];
  for (let i = 1; i <= n; i++) {
    const g = gst[i % 3]!;
    const same = g.startsWith('27');
    const row: Record<string, string> = {
      no: `S-${String(i).padStart(4, '0')}`,
      date: `${String((i % 28) + 1).padStart(2, '0')}/10/2026`,
      cust: `Customer ${i % 3}`,
      gstin: g,
      taxable: '1000.00',
      cgst: same ? '90.00' : '0',
      sgst: same ? '90.00' : '0',
      igst: same ? '0' : '180.00',
      total: '1180.00',
      ...badRows[i],
    };
    lines.push(
      [
        row.no,
        row.date,
        row.cust,
        row.gstin,
        row.taxable,
        row.cgst,
        row.sgst,
        row.igst,
        row.total,
      ].join(','),
    );
  }
  return lines.join('\n');
}

function pipeline(csv: string, c = ctx()) {
  const sheet = readSheet(csv, true);
  const mapping = guessMapping(sheet.headers, INVOICE_FIELDS);
  return {
    sheet,
    mapping,
    ...validateInvoiceRows(applyMapping(sheet, mapping, INVOICE_FIELDS), c),
  };
}

describe('column mapping', () => {
  it('guesses common header names and flags missing required fields', () => {
    const sheet = readSheet(invoiceCsv(1), true);
    const m = guessMapping(sheet.headers, INVOICE_FIELDS);
    expect(missingRequired(m, INVOICE_FIELDS)).toEqual([]);
    expect(m.number).toBe(0);
    expect(missingRequired({ ...m, total: -1 }, INVOICE_FIELDS)).toEqual(['Total amount']);
  });
});

describe('dates', () => {
  it('accepts common Indian formats and rejects impossible dates', () => {
    expect(normaliseDate('05/10/2026')).toBe('2026-10-05');
    expect(normaliseDate('5-1-2026')).toBe('2026-01-05');
    expect(normaliseDate('20261005')).toBe('2026-10-05');
    expect(normaliseDate('2026-10-05')).toBe('2026-10-05');
    expect(normaliseDate('31/02/2026')).toBeNull();
    expect(normaliseDate('hello')).toBeNull();
  });
});

describe('invoice import validation', () => {
  it('accepts a clean 40-invoice CSV', () => {
    const r = pipeline(invoiceCsv(40));
    expect(r.valid).toHaveLength(40);
    expect(summarise(r.report)).toEqual({ ok: 40, errors: 0, skipped: 0 });
    // original numbers are kept; FY derived from the date
    expect(r.valid[0]!.data.number).toBe('S-0001');
    expect(r.valid[0]!.data.fy).toBe('26-27');
  });

  it('rejects bad GSTINs with a row message naming the problem', () => {
    const r = pipeline(
      invoiceCsv(5, {
        2: { gstin: '27AAAAA0000A1Z5' }, // wrong checksum
        3: { gstin: '12345' }, // wrong length
        4: { gstin: 'ABCDEFGHIJKLMNO' }, // wrong pattern
      }),
    );
    expect(r.valid).toHaveLength(2);
    const byRow = new Map(r.report.map((x) => [x.row, x]));
    // data row n is spreadsheet row n + 1 (header is row 1)
    expect(byRow.get(3)).toMatchObject({ status: 'error' });
    expect(byRow.get(3)!.messages[0]).toMatch(/GSTIN "27AAAAA0000A1Z5" failed the checksum/);
    expect(byRow.get(4)!.messages[0]).toMatch(/must be 15 characters/);
    expect(byRow.get(5)!.messages[0]).toMatch(/wrong format/);
  });

  it('reports every problem on a row, not just the first', () => {
    const r = pipeline(invoiceCsv(1, { 1: { no: '', date: '32/13/2026', total: 'abc' } }));
    expect(r.report[0]!.status).toBe('error');
    expect(r.report[0]!.messages.join(' | ')).toMatch(/number is missing.*date.*Total/);
  });

  it('flags a total that does not equal taxable plus taxes, allows ₹1 round-off', () => {
    expect(pipeline(invoiceCsv(1, { 1: { total: '1200.00' } })).report[0]!.messages[0]).toMatch(
      /does not match/,
    );
    const ok = pipeline(
      invoiceCsv(1, {
        1: {
          gstin: generateGstin('27'),
          cgst: '90.00',
          sgst: '90.00',
          igst: '0',
          total: '1180.40',
        },
      }),
    );
    expect(ok.valid[0]!.data.round_off_paise).toBe(40);
  });

  it('skips numbers that already exist and rejects duplicates inside the file', () => {
    const r = pipeline(
      invoiceCsv(3, { 3: { no: 'S-0001' } }),
      ctx({ existingNumbers: new Set(['S-0002']) }),
    );
    const by = new Map(r.report.map((x) => [x.row, x]));
    expect(by.get(2)!.status).toBe('ok');
    expect(by.get(3)).toMatchObject({ status: 'skipped' });
    expect(by.get(4)!.status).toBe('error');
    expect(by.get(4)!.messages[0]).toMatch(/appears twice/);
  });

  it('rejects invoice numbers longer than 16 characters', () => {
    const r = pipeline(invoiceCsv(1, { 1: { no: 'A'.repeat(17) } }));
    expect(r.report[0]!.messages[0]).toMatch(/longer than 16/);
  });

  it('place of supply follows the customer GSTIN state', () => {
    const r = pipeline(invoiceCsv(3));
    const states = new Set(r.valid.map((v) => v.data.place_of_supply));
    expect(states).toEqual(new Set(['27', '29', '24']));
  });
});

describe('customer import validation', () => {
  const csv = (rows: string[]) => ['Name,GSTIN,Phone,Email,Credit Days', ...rows].join('\n');
  const run = (
    rows: string[],
    existing = { names: new Set<string>(), gstins: new Set<string>() },
  ) => {
    const sheet = readSheet(csv(rows), true);
    return validateCustomerRows(
      applyMapping(sheet, guessMapping(sheet.headers, CUSTOMER_FIELDS), CUSTOMER_FIELDS),
      existing,
    );
  };
  it('accepts good rows, derives state from GSTIN, rejects bad GSTIN and email', () => {
    const g = generateGstin('29');
    const r = run([`Alpha,${g},98,a@b.in,45`, 'Beta,27BAD,,x,30', ',,99,,']);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]!.data).toMatchObject({ name: 'Alpha', state_code: '29', credit_days: 45 });
    expect(r.report[1]!.messages.join(' ')).toMatch(/GSTIN "27BAD".*Email "x"/);
    expect(r.report[2]!.messages[0]).toMatch(/Name is missing/);
  });
  it('skips customers that exist already', () => {
    const r = run(['Alpha,,,,', 'alpha,,,,'], { names: new Set(['alpha']), gstins: new Set() });
    expect(r.valid).toHaveLength(0);
    expect(summarise(r.report).skipped).toBe(2);
  });
});

describe('committing a 40-invoice CSV', () => {
  it('creates missing customers once and inserts all 40 as imported, issued invoices', async () => {
    const r = pipeline(invoiceCsv(40));
    const inserted: Record<string, unknown>[] = [];
    let custId = 0;
    const { client } = fakeClient((call: FakeCall) => {
      const insert = call.ops.find(([n]) => n === 'insert');
      if (call.table === 'customers' && !insert) return { data: [], error: null };
      if (call.table === 'customers' && insert) {
        const rows = insert[1][0] as { name: string; gstin: string | null }[];
        return {
          data: rows.map((c) => ({ id: `c${++custId}`, name: c.name, gstin: c.gstin })),
          error: null,
        };
      }
      if (call.table === 'invoices' && insert)
        inserted.push(...(insert[1][0] as Record<string, unknown>[]));
      return { data: null, error: null };
    });
    const res = await commitInvoices('org', '27', 'tax_invoice', r.valid, client);
    expect(res).toMatchObject({ imported: 40, customersCreated: 3, failed: [] });
    expect(inserted).toHaveLength(40);
    expect(
      inserted.every((i) => i.source === 'import' && i.status === 'issued' && i.org_id === 'org'),
    ).toBe(true);
    expect(inserted[0]).toMatchObject({ number: 'S-0001', source_ref: 'import:S-0001' });
  });

  it('retries a rejected chunk row by row and names the failing rows', async () => {
    const r = pipeline(invoiceCsv(3));
    let invoiceCalls = 0;
    const { client } = fakeClient((call) => {
      const insert = call.ops.find(([n]) => n === 'insert');
      if (call.table === 'customers')
        return { data: insert ? [{ id: 'c', name: 'x', gstin: null }] : [], error: null };
      invoiceCalls++;
      const rows = insert![1][0];
      if (Array.isArray(rows)) return { data: null, error: { code: '23505', message: 'dup' } };
      return (rows as { number: string }).number === 'S-0002'
        ? { data: null, error: { code: '23505', message: 'dup' } }
        : { data: null, error: null };
    });
    const res = await commitInvoices('org', '27', 'tax_invoice', r.valid, client);
    expect(invoiceCalls).toBe(4);
    expect(res.imported).toBe(2);
    expect(res.failed).toEqual([
      { row: 3, status: 'error', messages: ['A record with the same value already exists.'] },
    ]);
  });
});

describe('Tally XML', () => {
  const supplierGstin = generateGstin('27');
  const buyerGstin = generateGstin('29');
  const xml = `<?xml version="1.0"?>
<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>
 <TALLYMESSAGE xmlns:UDF="TallyUDF">
  <LEDGER NAME="Buyer Co" RESERVEDNAME="">
   <PARENT>Sundry Debtors</PARENT>
   <PARTYGSTIN>${buyerGstin}</PARTYGSTIN>
   <ADDRESS.LIST><ADDRESS>9 Lake Rd</ADDRESS><ADDRESS>Bengaluru</ADDRESS></ADDRESS.LIST>
   <BILLCREDITPERIOD>45 Days</BILLCREDITPERIOD>
   <OPENINGBALANCE>0</OPENINGBALANCE>
  </LEDGER>
  <LEDGER NAME="HDFC Bank"><PARENT>Bank Accounts</PARENT></LEDGER>
  <VOUCHER VCHTYPE="Sales" ACTION="Create">
   <DATE>20261001</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>T-001</VOUCHERNUMBER>
   <PARTYLEDGERNAME>Buyer Co</PARTYLEDGERNAME><PARTYGSTIN>${buyerGstin}</PARTYGSTIN>
   <NARRATION>thanks</NARRATION>
   <ALLLEDGERENTRIES.LIST><LEDGERNAME>Buyer Co</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1180.00</AMOUNT><BILLALLOCATIONS.LIST><NAME>T-001</NAME></BILLALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST>
   <ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
   <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output IGST 18%</LEDGERNAME><AMOUNT>180.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  </VOUCHER>
  <VOUCHER VCHTYPE="Receipt"><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>R-9</VOUCHERNUMBER></VOUCHER>
  <VOUCHER VCHTYPE="Sales"><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>T-002</VOUCHERNUMBER><ISCANCELLED>Yes</ISCANCELLED></VOUCHER>
 </TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

  it('reads debtor ledgers and sales vouchers, skips and reports the rest', () => {
    const t = parseTallyXml(xml);
    expect(t.customers).toHaveLength(1);
    expect(t.customers[0]!.values).toMatchObject({
      name: 'Buyer Co',
      gstin: buyerGstin,
      address: '9 Lake Rd, Bengaluru',
      credit_days: '45 Days',
    });
    expect(t.invoices).toHaveLength(1);
    expect(t.invoices[0]!.values).toMatchObject({
      number: 'T-001',
      date: '20261001',
      customerName: 'Buyer Co',
      taxable: '1000.00',
      igst: '180.00',
      cgst: '0.00',
      total: '1180.00',
    });
    expect(t.skippedTags).toMatchObject({
      NARRATION: 1,
      OPENINGBALANCE: 1,
      'BILLALLOCATIONS.LIST': 1,
    });
    expect(t.notes.join(' ')).toMatch(/HDFC Bank.*not Sundry Debtors/);
    expect(t.notes.join(' ')).toMatch(/R-9.*not a sales voucher/);
    expect(t.notes.join(' ')).toMatch(/T-002.*cancelled/);
  });

  it('feeds the same validation as CSV', () => {
    const t = parseTallyXml(xml);
    const v = validateInvoiceRows(
      t.invoices,
      ctx({ supplierStateCode: supplierGstin.slice(0, 2) }),
    );
    expect(v.valid).toHaveLength(1);
    expect(v.valid[0]!.data).toMatchObject({
      number: 'T-001',
      issue_date: '2026-10-01',
      place_of_supply: '29',
      total_paise: 118000,
    });
  });

  it('rejects text that is not XML', () => {
    expect(() => parseTallyXml('<a><b></a>')).toThrowError(/not valid XML/);
  });
});

describe('Excel input', () => {
  it('reads an .xlsx workbook the same way as CSV', async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'GSTIN'],
      ['Acme', generateGstin('27')],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Customers');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const sheet = readSheet(buf, false);
    expect(sheet.headers).toEqual(['Name', 'GSTIN']);
    expect(sheet.rows[0]![0]).toBe('Acme');
  });
});
