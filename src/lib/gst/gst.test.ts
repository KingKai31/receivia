import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { paise, parseRupees } from '@/lib/money';
import {
  COMPOSITION_HEADING,
  GST_RATES,
  GST_STATES,
  GstError,
  assertStateCode,
  calcInvoice,
  calcLine,
  eInvoiceNote,
  invoiceHeading,
  invoiceSubheading,
  invoiceTypeFor,
  percentDiscount,
  placeOfSupply,
} from './index';

const r = parseRupees;

describe('line and invoice calculation', () => {
  it('10,000 @18% same state = CGST 900 + SGST 900 = 11,800', () => {
    const inv = calcInvoice({
      lines: [{ qty: 1, rate: r('10000'), gstRate: 18 }],
      supplierStateCode: '27',
      placeOfSupply: '27',
      registrationType: 'regular',
    });
    expect(inv.intraState).toBe(true);
    expect(inv.cgst).toBe(r('900'));
    expect(inv.sgst).toBe(r('900'));
    expect(inv.igst).toBe(0);
    expect(inv.grandTotal).toBe(r('11800'));
    expect(inv.roundOff).toBe(0);
  });

  it('other state = IGST 1,800 = 11,800', () => {
    const inv = calcInvoice({
      lines: [{ qty: 1, rate: r('10000'), gstRate: 18 }],
      supplierStateCode: '27',
      placeOfSupply: '29',
      registrationType: 'regular',
    });
    expect(inv.intraState).toBe(false);
    expect(inv.igst).toBe(r('1800'));
    expect(inv.cgst + inv.sgst).toBe(0);
    expect(inv.grandTotal).toBe(r('11800'));
  });

  it('3 x 333 @5% same state rounds CGST and SGST separately, then to whole rupee', () => {
    const inv = calcInvoice({
      lines: [{ qty: 3, rate: r('333'), gstRate: 5 }],
      supplierStateCode: '27',
      placeOfSupply: '27',
      registrationType: 'regular',
    });
    expect(inv.taxable).toBe(r('999'));
    // 2.5% of 99900 paise = 2497.5 -> 2498 each
    expect(inv.cgst).toBe(2498);
    expect(inv.sgst).toBe(2498);
    expect(inv.subtotal).toBe(104896);
    expect(inv.roundOff).toBe(4);
    expect(inv.grandTotal).toBe(r('1049'));
  });

  it('10% discount line reduces taxable value before tax', () => {
    const gross = paise(2 * r('500'));
    const line = calcLine(
      { qty: 2, rate: r('500'), discount: percentDiscount(gross, 10), gstRate: 18 },
      false,
    );
    expect(line.taxable).toBe(r('900'));
    expect(line.igst).toBe(r('162'));
    expect(line.total).toBe(r('1062'));
  });

  it('composition dealer collects no tax and gets a Bill of Supply', () => {
    const inv = calcInvoice({
      lines: [{ qty: 1, rate: r('10000'), gstRate: 18 }],
      supplierStateCode: '27',
      placeOfSupply: '27',
      registrationType: 'composition',
    });
    expect(inv.totalTax).toBe(0);
    expect(inv.grandTotal).toBe(r('10000'));
    expect(inv.invoiceType).toBe('bill_of_supply');
    expect(invoiceHeading('composition')).toBe('Bill of Supply');
    expect(invoiceSubheading('composition')).toBe(COMPOSITION_HEADING);
  });

  it('unregistered supplier gets a plain invoice with no tax', () => {
    expect(invoiceTypeFor('unregistered')).toBe('invoice');
    expect(invoiceSubheading('unregistered')).toBeNull();
    const inv = calcInvoice({
      lines: [{ qty: 2, rate: r('50'), gstRate: 5 }],
      supplierStateCode: '27',
      placeOfSupply: '29',
      registrationType: 'unregistered',
    });
    expect(inv.totalTax).toBe(0);
  });

  it('0% item has no tax', () => {
    const inv = calcInvoice({
      lines: [{ qty: 5, rate: r('100'), gstRate: 0 }],
      supplierStateCode: '27',
      placeOfSupply: '27',
      registrationType: 'regular',
    });
    expect(inv.totalTax).toBe(0);
    expect(inv.grandTotal).toBe(r('500'));
  });

  it('rejects rates outside the table, bad quantity, and over-discount', () => {
    expect(() => calcLine({ qty: 1, rate: r('10'), gstRate: 12 }, true)).toThrow(GstError);
    expect(() => calcLine({ qty: -1, rate: r('10'), gstRate: 5 }, true)).toThrow(GstError);
    expect(() => calcLine({ qty: 1, rate: r('10'), discount: r('11'), gstRate: 5 }, true)).toThrow(
      GstError,
    );
  });

  it('round-off is always within half a rupee and grand total is whole rupees', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            qty: fc.integer({ min: 1, max: 1000 }),
            rate: fc.integer({ min: 1, max: 10_000_000 }).map(paise),
            gstRate: fc.constantFrom(...GST_RATES),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        fc.boolean(),
        (lines, intra) => {
          const inv = calcInvoice({
            lines,
            supplierStateCode: '27',
            placeOfSupply: intra ? '27' : '29',
            registrationType: 'regular',
          });
          expect(inv.grandTotal % 100).toBe(0);
          expect(Math.abs(inv.roundOff)).toBeLessThanOrEqual(50);
        },
      ),
    );
  });
});

describe('property: CGST+SGST vs IGST differ by at most 1 paisa per line', () => {
  it('holds for any taxable value and rate', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 ** 11 }),
        fc.constantFrom(...GST_RATES),
        (amount, gstRate) => {
          const line = { qty: 1, rate: paise(amount), gstRate };
          const intra = calcLine(line, true);
          const inter = calcLine(line, false);
          expect(Math.abs(intra.cgst + intra.sgst - inter.igst)).toBeLessThanOrEqual(1);
          expect(intra.cgst).toBe(intra.sgst);
        },
      ),
    );
  });
});

describe('place of supply, state table, e-invoice', () => {
  it('state table has 97 and 99 and rejects unknown codes', () => {
    expect(GST_STATES['97']).toBeDefined();
    expect(GST_STATES['99']).toBeDefined();
    for (const bad of ['00', '25', '28', '39', '98', 'AB', '', '7']) {
      expect(() => assertStateCode(bad)).toThrow(GstError);
    }
  });
  it('place of supply follows buyer GSTIN, then buyer state, then supplier state', () => {
    expect(placeOfSupply({ supplierStateCode: '27', buyerGstin: '29ABCDE1234F1Z5' })).toBe('29');
    expect(placeOfSupply({ supplierStateCode: '27', buyerStateCode: '24' })).toBe('24');
    expect(placeOfSupply({ supplierStateCode: '27' })).toBe('27');
    expect(() => placeOfSupply({ supplierStateCode: '27', buyerGstin: '00ABCDE1234F1Z5' })).toThrow(
      GstError,
    );
  });
  it('e-invoice note only above 5 crore turnover', () => {
    expect(eInvoiceNote(parseRupees('50000000'))).toBeNull();
    expect(eInvoiceNote(parseRupees('50000001'))).not.toBeNull();
  });
});
