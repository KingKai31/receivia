import { describe, expect, it } from 'vitest';
import {
  isReadyToGetPaid,
  issueGate,
  requiredHsnDigits,
  scorePayability,
  type PayabilityInput,
} from '.';

const good: PayabilityInput = {
  buyer: {
    gstin: '27AAACR5055K1Z7',
    gstinValid: true,
    stateCode: '27',
    poRequired: true,
    apName: 'Asha',
    apEmail: 'ap@x.in',
    apPhone: null,
  },
  placeOfSupply: '27',
  poNumber: 'PO-1',
  hasGoods: true,
  interState: false,
  goodsValuePaise: 1_000_000,
  delivery: { ewayBillNo: null, reference: 'GRN-9', proofUploaded: false },
  hsnCodes: ['48191010'],
  turnoverPaise: 10_000_000_000,
  dueDate: '2026-11-30',
  issueDate: '2026-10-31',
  creditDays: 30,
  bank: { account: true, upi: false },
};
const with_ = (p: Partial<PayabilityInput>): PayabilityInput => ({ ...good, ...p });

const table: [string, PayabilityInput, number][] = [
  ['everything present', good, 100],
  ['no GSTIN', with_({ buyer: { ...good.buyer, gstin: null } }), 85],
  ['invalid GSTIN', with_({ buyer: { ...good.buyer, gstinValid: false } }), 85],
  ['GSTIN state differs from place of supply', with_({ placeOfSupply: '29' }), 93],
  ['PO missing and required', with_({ poNumber: null }), 90],
  [
    'PO missing, not required',
    with_({ poNumber: null, buyer: { ...good.buyer, poRequired: false } }),
    95,
  ],
  ['AP contact half', with_({ buyer: { ...good.buyer, apEmail: null } }), 93],
  ['no AP contact', with_({ buyer: { ...good.buyer, apName: null, apEmail: null } }), 85],
  [
    'inter-state goods over 50k without e-way bill',
    with_({
      interState: true,
      goodsValuePaise: 5_000_001,
      delivery: { ewayBillNo: null, reference: 'GRN', proofUploaded: true },
    }),
    80,
  ],
  [
    'inter-state over 50k with e-way bill',
    with_({
      interState: true,
      goodsValuePaise: 9_000_000,
      placeOfSupply: '27',
      delivery: { ewayBillNo: '123456789012', reference: null, proofUploaded: false },
    }),
    100,
  ],
  [
    'exactly 50k inter-state needs nothing extra',
    with_({ interState: true, goodsValuePaise: 5_000_000 }),
    100,
  ],
  [
    'no delivery reference',
    with_({ delivery: { ewayBillNo: null, reference: null, proofUploaded: false } }),
    80,
  ],
  [
    'delivery photo counts',
    with_({ delivery: { ewayBillNo: null, reference: null, proofUploaded: true } }),
    100,
  ],
  [
    'services need no delivery ref',
    with_({
      hasGoods: false,
      delivery: { ewayBillNo: null, reference: null, proofUploaded: false },
    }),
    100,
  ],
  ['HSN too short above 5 crore', with_({ hsnCodes: ['4819'] }), 90],
  [
    'HSN 4 digits ok up to 5 crore',
    with_({ hsnCodes: ['4819'], turnoverPaise: 3_000_000_000 }),
    100,
  ],
  [
    'HSN not needed under 1.5 crore',
    with_({ hsnCodes: [null], turnoverPaise: 1_000_000_000 }),
    100,
  ],
  ['no due date', with_({ dueDate: null }), 85],
  ['due before issue', with_({ dueDate: '2026-10-01' }), 85],
  ['no bank or UPI', with_({ bank: { account: false, upi: false } }), 85],
  ['UPI only', with_({ bank: { account: false, upi: true } }), 100],
  [
    'nothing at all',
    with_({
      buyer: {
        gstin: null,
        gstinValid: false,
        stateCode: null,
        poRequired: true,
        apName: null,
        apEmail: null,
        apPhone: null,
      },
      poNumber: null,
      delivery: { ewayBillNo: null, reference: null, proofUploaded: false },
      hsnCodes: [''],
      dueDate: null,
      creditDays: null,
      bank: { account: false, upi: false },
    }),
    0,
  ],
];

describe('scorePayability', () => {
  it.each(table)('%s', (_n, input, score) => {
    expect(scorePayability(input).score).toBe(score);
  });
  it('weights sum to 100 and failures carry reasons', () => {
    const r = scorePayability(with_({ poNumber: null }));
    expect(r.checks.reduce((s, c) => s + c.max, 0)).toBe(100);
    expect(r.reasons.join(' ')).toMatch(/PO/);
  });
  it('hsn tiers', () => {
    expect([
      requiredHsnDigits(1_000_000_000),
      requiredHsnDigits(2_000_000_000),
      requiredHsnDigits(9_000_000_000),
    ]).toEqual([0, 4, 6]);
  });
});

describe('issueGate', () => {
  it('blocks below threshold, allows at it', () => {
    expect(issueGate(69, 70).allowed).toBe(false);
    expect(issueGate(70, 70).allowed).toBe(true);
    expect(issueGate(50, 40).allowed).toBe(true);
  });
  it('ready badge', () => {
    expect(isReadyToGetPaid(85)).toBe(true);
    expect(isReadyToGetPaid(84)).toBe(false);
    expect(isReadyToGetPaid(null)).toBe(false);
  });
});
